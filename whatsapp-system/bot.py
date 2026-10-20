
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import html
import logging
import os
import random
import re
import sqlite3
import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatType, ParseMode
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "8752731392:AAELsSfD67YcTKPolX_UfWx17RXEyeg0Lgg")
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "aqe.sqlite3"

APP_NAME = "Aiham Quiz Engine"
STARTING_POINTS = 50
STAKE_POINTS = 5
QUESTION_TIME_LIMIT = 30
PENDING_CHALLENGE_TIMEOUT = 60
TIE_WINDOW_SECONDS = 0.40
MAX_CONCURRENT_UPDATES = 32

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
log = logging.getLogger(APP_NAME)

DB_LOCK = threading.RLock()
STATE_LOCK = asyncio.Lock()
ACTIVE: dict[str, "Challenge"] = {}

AR_DIAC = re.compile(r"[\u064B-\u0652\u0670\u0653\u0654\u0655\u0640]")
DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
PUNCT = str.maketrans({c: " " for c in "،؛؟!?.,:;«»“”()[]{}_/\\|-+=*#@~`"})
WORD = re.compile(r"\s+")

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.translate(DIGITS).lower()
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    s = s.replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي").replace("ة", "ه")
    s = AR_DIAC.sub("", s).translate(PUNCT)
    return WORD.sub(" ", s).strip()

def esc(s: str) -> str:
    return html.escape(s or "", quote=False)

def uname(u) -> str:
    return (u.username or "").lower() if getattr(u, "username", None) else ""

def dname(u) -> str:
    return getattr(u, "full_name", None) or getattr(u, "first_name", None) or "مستخدم"

def mhtml(u) -> str:
    return f'<a href="tg://user?id={u.id}">{esc(dname(u))}</a>'

def ts(dt: datetime) -> int:
    return int(dt.timestamp())

def group_chat(chat) -> bool:
    return bool(chat and chat.type in {ChatType.GROUP, ChatType.SUPERGROUP})

QUESTION_BANK: dict[str, dict[str, Any]] = {
    "quran": {"name": "القرآن", "aliases": ["قرآن", "quran"], "questions": [
        ("كم عدد سور القرآن الكريم؟", ["114"]),
        ("كم عدد أجزاء القرآن الكريم؟", ["30"]),
        ("كم عدد صفحات المصحف المدني الشائع؟", ["604"]),
        ("ما اسم أول سورة في القرآن الكريم؟", ["الفاتحة"]),
        ("ما اسم أطول سورة في القرآن الكريم؟", ["البقرة"]),
    ]},
    "anime": {"name": "الأنمي", "aliases": ["انمي", "أنمي", "anime"], "questions": [
        ("من مؤلف ون بيس؟", ["إيتشيرو أودا", "ايتشيرو اودا", "eiichiro oda"]),
        ("من مؤلف ناروتو؟", ["ماساشي كيشيموتو", "masashi kishimoto"]),
        ("ما اسم بطل دراغون بول الأساسي؟", ["غوكو", "سون غوكو", "goku"]),
        ("ما اسم بطل بليتش؟", ["ايتشيغو كوروساكي", "ichigo kurosaki"]),
        ("ما اسم قرية ناروتو الرئيسية؟", ["كونوها", "konoha"]),
    ]},
    "science": {"name": "العلوم", "aliases": ["علوم", "science"], "questions": [
        ("ما الصيغة الكيميائية للماء؟", ["h2o"]),
        ("ما الغاز الذي تتنفسه الكائنات الحية غالبًا؟", ["الأكسجين", "اكسجين", "oxygen"]),
        ("ما وحدة قياس شدة التيار الكهربائي؟", ["أمبير", "ampere", "amp"]),
        ("ما كوكب الأرض من حيث البعد عن الشمس؟", ["الثالث", "3"]),
        ("ما العضو المسؤول عن ضخ الدم في الجسم؟", ["القلب", "heart"]),
    ]},
    "history": {"name": "التاريخ", "aliases": ["تاريخ", "history"], "questions": [
        ("في أي سنة سقطت الأندلس؟", ["1492"]),
        ("في أي سنة بدأت الحرب العالمية الثانية؟", ["1939"]),
        ("من أول خليفة بعد وفاة الرسول ﷺ؟", ["أبو بكر الصديق", "ابو بكر الصديق", "abu bakr"]),
        ("من بنى الهرم الأكبر؟", ["خوفو", "khufu"]),
        ("في أي سنة فتحت مكة؟", ["630"]),
    ]},
    "geography": {"name": "الجغرافيا", "aliases": ["جغرافيا", "geography"], "questions": [
        ("ما عاصمة فرنسا؟", ["باريس", "paris"]),
        ("ما عاصمة اليابان؟", ["طوكيو", "tokyo"]),
        ("ما أكبر قارة في العالم؟", ["آسيا", "اسيا", "asia"]),
        ("ما أطول نهر في العالم؟", ["النيل", "nile"]),
        ("ما أصغر دولة في العالم؟", ["الفاتيكان", "vatican"]),
    ]},
    "arabic": {"name": "اللغة العربية", "aliases": ["عربي", "العربية", "arabic"], "questions": [
        ("كم عدد حروف اللغة العربية؟", ["28"]),
        ("ما جمع كلمة كتاب؟", ["كتب"]),
        ("ما ضد كلمة شجاع؟", ["جبان"]),
        ("ما مرادف كلمة سريع؟", ["عاجل"]),
        ("ما اسم علامة التنوين على الفتح؟", ["تنوين الفتح"]),
    ]},
    "tech": {"name": "التقنية", "aliases": ["تقنية", "تكنولوجيا", "tech"], "questions": [
        ("ماذا تعني CPU؟", ["وحدة المعالجة المركزية", "central processing unit"]),
        ("ماذا تعني RAM؟", ["ذاكرة الوصول العشوائي", "random access memory"]),
        ("ما بروتوكول مواقع الويب الآمنة؟", ["https"]),
        ("ما امتداد ملفات بايثون؟", [".py", "py"]),
        ("ما نظام تشغيل الهواتف المفتوح المصدر الشائع؟", ["أندرويد", "android"]),
    ]},
    "iq": {"name": "الذكاء", "aliases": ["ذكاء", "iq"], "questions": [
        ("7 + 5 = ؟", ["12"]),
        ("9 - 4 = ؟", ["5"]),
        ("3 × 4 = ؟", ["12"]),
        ("18 ÷ 2 = ؟", ["9"]),
        ("العدد التالي: 2، 4، 6، ؟", ["8"]),
    ]},
    "sports": {"name": "الرياضة", "aliases": ["رياضة", "رياضه", "sports"], "questions": [
        ("كم عدد لاعبي فريق كرة القدم داخل الملعب؟", ["11"]),
        ("ما اللعبة التي تستخدم مضربًا وريشة؟", ["تنس الريشة", "badminton"]),
        ("كم شوطًا في كرة القدم الأمريكية؟", ["4"]),
        ("ما اسم كأس بطولة كرة القدم العالمية؟", ["كأس العالم", "world cup"]),
        ("ما اسم ملعب ريال مدريد الشهير؟", ["سانتياغو برنابيو", "santiago bernabeu"]),
    ]},
    "mixed": {"name": "منوعات", "aliases": ["منوعات", "mixed", "general"], "questions": [
        ("ما لون البحر عادةً؟", ["أزرق", "ازرق", "blue"]),
        ("بماذا نقيس الوقت؟", ["الساعة", "clock", "watch"]),
        ("ما اسم كوكبنا؟", ["الأرض", "الارض", "earth"]),
        ("ما عاصمة مصر؟", ["القاهرة", "cairo"]),
        ("ما عكس كلمة الليل؟", ["النهار", "day"]),
    ]},
}
CATEGORY_ORDER = ["quran", "anime", "science", "history", "geography", "arabic", "tech", "iq", "sports", "mixed"]
SPEED_PROMPTS = [
    "السرعة تصنع الفائز",
    "اكتب بسرعة دون أخطاء",
    "الفائز هو الأسرع دائمًا",
    "كل ثانية تفرق في النتيجة",
    "Aiham Quiz Engine سريع جدًا",
    "لا تتوقف حتى النهاية",
    "الكتابة السريعة مهارة مهمة",
    "من يصل أولًا يربح الجولة",
]
CATEGORY_HINTS = "، ".join(QUESTION_BANK[k]["name"] for k in CATEGORY_ORDER)

@dataclass
class Challenge:
    cid: str
    chat_id: int
    challenger_id: int
    challenger_name: str
    opponent_id: int
    opponent_name: str
    mode: str  # questions | speed
    category_key: str
    category_name: str
    question: str
    answers: tuple[str, ...]
    stake: int = STAKE_POINTS
    state: str = "pending"  # pending | active | resolved | canceled
    created_at: float = field(default_factory=time.monotonic)
    accepted_at: float = 0.0
    first_uid: Optional[int] = None
    first_second: Optional[int] = None
    tie: bool = False
    resolved: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    pending_task: Optional[asyncio.Task] = field(default=None, repr=False)
    timeout_task: Optional[asyncio.Task] = field(default=None, repr=False)
    finalize_task: Optional[asyncio.Task] = field(default=None, repr=False)

# ---------------- DB ----------------

def db() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL;")
    c.execute("PRAGMA synchronous=NORMAL;")
    return c

def init_db() -> None:
    with DB_LOCK:
        c = db()
        c.executescript("""
        CREATE TABLE IF NOT EXISTS players(
            user_id INTEGER PRIMARY KEY,
            first_name TEXT NOT NULL,
            username TEXT,
            display_name TEXT NOT NULL,
            joined_at INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            points INTEGER NOT NULL DEFAULT 50,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            games INTEGER NOT NULL DEFAULT 0,
            challenges_created INTEGER NOT NULL DEFAULT 0,
            challenges_accepted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
        CREATE INDEX IF NOT EXISTS idx_players_points ON players(points DESC);
        CREATE TABLE IF NOT EXISTS history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cid TEXT NOT NULL,
            chat_id INTEGER NOT NULL,
            challenger_id INTEGER NOT NULL,
            opponent_id INTEGER NOT NULL,
            mode TEXT NOT NULL,
            category_key TEXT NOT NULL,
            result TEXT NOT NULL,
            winner_id INTEGER,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            stake INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL
        );
        """)
        c.commit()
        c.close()

async def qone(sql: str, params: tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
    def _():
        with DB_LOCK:
            c = db()
            r = c.execute(sql, params).fetchone()
            c.close()
            return r
    return await asyncio.to_thread(_)

async def qall(sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    def _():
        with DB_LOCK:
            c = db()
            r = c.execute(sql, params).fetchall()
            c.close()
            return r
    return await asyncio.to_thread(_)

async def exec1(sql: str, params: tuple[Any, ...] = ()) -> None:
    def _():
        with DB_LOCK:
            c = db()
            c.execute(sql, params)
            c.commit()
            c.close()
    await asyncio.to_thread(_)

async def execmany(items: list[tuple[str, tuple[Any, ...]]]) -> None:
    def _():
        with DB_LOCK:
            c = db()
            cur = c.cursor()
            for sql, params in items:
                cur.execute(sql, params)
            c.commit()
            c.close()
    await asyncio.to_thread(_)

async def ensure_player(u) -> None:
    row = await qone("SELECT user_id FROM players WHERE user_id=?", (u.id,))
    now = int(time.time())
    name = dname(u)
    usern = uname(u) or None
    if row is None:
        await exec1(
            "INSERT INTO players(user_id, first_name, username, display_name, joined_at, last_seen, points) VALUES(?,?,?,?,?,?,?)",
            (u.id, u.first_name or "", usern, name, now, now, STARTING_POINTS),
        )
    else:
        await exec1(
            "UPDATE players SET first_name=?, username=?, display_name=?, last_seen=? WHERE user_id=?",
            (u.first_name or "", usern, name, now, u.id),
        )

async def player(uid: int) -> Optional[sqlite3.Row]:
    return await qone("SELECT * FROM players WHERE user_id=?", (uid,))

async def player_by_username(username: str) -> Optional[sqlite3.Row]:
    return await qone("SELECT * FROM players WHERE lower(username)=?", (username.lower().lstrip("@"),))

async def top_players(limit: int = 10) -> list[sqlite3.Row]:
    return await qall("SELECT * FROM players ORDER BY points DESC, wins DESC, games ASC LIMIT ?", (limit,))

async def deduct_pair(ch: Challenge) -> bool:
    a = await player(ch.challenger_id)
    b = await player(ch.opponent_id)
    if not a or not b or a["points"] < ch.stake or b["points"] < ch.stake:
        return False
    await execmany([
        ("UPDATE players SET points=points-?, last_seen=? WHERE user_id=?", (ch.stake, int(time.time()), ch.challenger_id)),
        ("UPDATE players SET points=points-?, last_seen=? WHERE user_id=?", (ch.stake, int(time.time()), ch.opponent_id)),
    ])
    return True

async def refund_pair(ch: Challenge) -> None:
    await execmany([
        ("UPDATE players SET points=points+?, last_seen=? WHERE user_id=?", (ch.stake, int(time.time()), ch.challenger_id)),
        ("UPDATE players SET points=points+?, last_seen=? WHERE user_id=?", (ch.stake, int(time.time()), ch.opponent_id)),
    ])

async def award_win(ch: Challenge, winner_id: int) -> None:
    loser_id = ch.opponent_id if winner_id == ch.challenger_id else ch.challenger_id
    await execmany([
        ("UPDATE players SET points=points+?, wins=wins+1, games=games+1, last_seen=? WHERE user_id=?", (ch.stake * 2, int(time.time()), winner_id)),
        ("UPDATE players SET losses=losses+1, games=games+1, last_seen=? WHERE user_id=?", (int(time.time()), loser_id)),
    ])

async def award_draw(ch: Challenge) -> None:
    await execmany([
        ("UPDATE players SET points=points+?, draws=draws+1, games=games+1, last_seen=? WHERE user_id=?", (ch.stake, int(time.time()), ch.challenger_id)),
        ("UPDATE players SET points=points+?, draws=draws+1, games=games+1, last_seen=? WHERE user_id=?", (ch.stake, int(time.time()), ch.opponent_id)),
    ])

async def history(ch: Challenge, result: str, winner_id: Optional[int]) -> None:
    await exec1(
        """INSERT INTO history(cid, chat_id, challenger_id, opponent_id, mode, category_key, result, winner_id, question, answer, stake, created_at, ended_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ch.cid, ch.chat_id, ch.challenger_id, ch.opponent_id, ch.mode, ch.category_key, result, winner_id, ch.question, ",".join(ch.answers), ch.stake, int(time.time()), int(time.time())),
    )

# ---------------- state ----------------

async def add_challenge(ch: Challenge) -> None:
    async with STATE_LOCK:
        ACTIVE[ch.cid] = ch

async def remove_challenge(cid: str) -> None:
    async with STATE_LOCK:
        ACTIVE.pop(cid, None)

async def get_challenge(cid: str) -> Optional[Challenge]:
    async with STATE_LOCK:
        return ACTIVE.get(cid)

async def pending_for(chat_id: int, opponent_id: int) -> Optional[Challenge]:
    async with STATE_LOCK:
        items = [c for c in ACTIVE.values() if c.chat_id == chat_id and c.opponent_id == opponent_id and c.state == "pending" and not c.resolved]
        return sorted(items, key=lambda c: c.created_at, reverse=True)[0] if items else None

async def active_for_chat(chat_id: int) -> Optional[Challenge]:
    async with STATE_LOCK:
        items = [c for c in ACTIVE.values() if c.chat_id == chat_id and c.state == "active" and not c.resolved]
        return sorted(items, key=lambda c: c.accepted_at, reverse=True)[0] if items else None

async def chat_busy(chat_id: int) -> bool:
    async with STATE_LOCK:
        return any(c.chat_id == chat_id and c.state in {"pending", "active"} and not c.resolved for c in ACTIVE.values())

# ---------------- helpers ----------------

def question_text(ch: Challenge) -> str:
    if ch.mode == "speed":
        return (
            f"⚡ <b>بدأ تحدي السرعة</b>\n\n"
            f"المتحديان:\n• {esc(ch.challenger_name)}\n• {esc(ch.opponent_name)}\n\n"
            f"انسخ النص التالي كما هو مع نقطة البداية:\n<code>.{esc(ch.question)}</code>\n\n"
            f"⏳ الوقت: <b>{QUESTION_TIME_LIMIT}</b> ثانية"
        )
    return (
        f"━━━━━━━━━━━━━━\n"
        f"📚 <b>بدأ التحدي</b>\n"
        f"الفئة: <b>{esc(ch.category_name)}</b>\n\n"
        f"السؤال:\n<b>{esc(ch.question)}</b>\n\n"
        f"الإجابة فقط بصيغة:\n<code>.الإجابة</code>\n\n"
        f"⏳ الوقت: <b>{QUESTION_TIME_LIMIT}</b> ثانية\n"
        f"━━━━━━━━━━━━━━"
    )

def invite_text(ch: Challenge) -> str:
    return (
        f"⚔ <b>إشعار تحدي</b>\n\n"
        f"من: {esc(ch.challenger_name)}\n"
        f"إلى: {esc(ch.opponent_name)}\n"
        f"النوع: <b>{esc('تحدي أسئلة' if ch.mode == 'questions' else 'تحدي سرعة')}</b>\n"
        f"الفئة: <b>{esc(ch.category_name)}</b>\n"
        f"الرهان: <b>{ch.stake}</b> نقاط من كل لاعب\n\n"
        f"اكتب <code>!نعم</code> أو <code>!لا</code>"
    )

def help_text() -> str:
    return (
        f"🎮 <b>{esc(APP_NAME)}</b>\n\n"
        "الأوامر:\n"
        "• <code>!تحدي @الخصم القرآن</code>\n"
        "• <code>!تحدي @الخصم سرعة</code>\n"
        "• <code>!نعم</code> / <code>!لا</code>\n"
        "• <code>!نقاط</code>\n"
        "• <code>!ترتيب</code>\n\n"
        "الإجابة أثناء التحدي:\n"
        "• اكتب <code>.</code> ثم الإجابة مباشرة.\n\n"
        f"الفئات: {esc(CATEGORY_HINTS)}"
    )

def name_from_row(r: sqlite3.Row) -> str:
    if r["username"]:
        return f"@{esc(r['username'])}"
    return esc(r["display_name"])

def leader_text(rows: list[sqlite3.Row]) -> str:
    if not rows:
        return "لا يوجد لاعبين بعد."
    med = ["🥇", "🥈", "🥉"]
    out = [f"🏆 <b>لوحة الصدارة</b>", ""]
    for i, r in enumerate(rows, 1):
        prefix = med[i-1] if i <= 3 else f"{i}."
        out.append(f"{prefix} {name_from_row(r)} — <b>{r['points']}</b> نقطة (W:{r['wins']} L:{r['losses']} D:{r['draws']})")
    return "\n".join(out)

def parse_category(raw: str) -> tuple[Optional[str], Optional[str]]:
    n = norm(raw)
    if not n:
        return None, None
    if any(x in n for x in ["سرعة", "سرعه", "speed", "typing", "كتابة"]):
        return "speed", "السرعة"
    for k in CATEGORY_ORDER:
        cat = QUESTION_BANK[k]
        if any(norm(a) in n for a in [cat["name"], *cat["aliases"]]):
            return "questions", cat["name"]
    if any(x in n for x in ["اسئلة", "اسئله", "سؤال", "quiz", "questions"]):
        k = random.choice(CATEGORY_ORDER)
        return "questions", QUESTION_BANK[k]["name"]
    return None, None

def extract_username(text: str) -> Optional[str]:
    m = re.search(r"@([A-Za-z0-9_]{5,32})", text or "")
    return m.group(1).lower() if m else None

def extract_cmd_body(text: str) -> str:
    return (text or "").strip()[1:].strip() if (text or "").strip().startswith("!") else (text or "").strip()

def pick_question(category_key: str) -> tuple[str, tuple[str, ...]]:
    q, a = random.choice(QUESTION_BANK[category_key]["questions"])
    return q, tuple(a)

def pick_speed() -> tuple[str, tuple[str, ...]]:
    p = random.choice(SPEED_PROMPTS)
    return p, (p,)

def matches(candidate: str, answers: tuple[str, ...]) -> bool:
    c = norm(candidate)
    return any(c == norm(a) for a in answers)

# ---------------- core flow ----------------

async def start_pending_timeout(ch: Challenge, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        await asyncio.sleep(PENDING_CHALLENGE_TIMEOUT)
        async with ch.lock:
            if ch.resolved or ch.state != "pending":
                return
            ch.state = "canceled"
            ch.resolved = True
        await remove_challenge(ch.cid)
        await context.bot.send_message(ch.chat_id, f"⌛ انتهى وقت قبول التحدي بين {esc(ch.challenger_name)} و {esc(ch.opponent_name)}.", parse_mode=ParseMode.HTML)
    except asyncio.CancelledError:
        pass

async def start_round_timeout(ch: Challenge, context: ContextTypes.DEFAULT_TYPE) -> None:
    try:
        await asyncio.sleep(QUESTION_TIME_LIMIT)
        async with ch.lock:
            if ch.resolved or ch.state != "active":
                return
            ch.state = "resolved"
            ch.resolved = True
        await refund_pair(ch)
        await award_draw(ch)
        await history(ch, "timeout", None)
        await remove_challenge(ch.cid)
        await context.bot.send_message(
            ch.chat_id,
            f"⏱ انتهى الوقت بدون فائز.\nتمت إعادة النقاط للطرفين.\n\nالإجابة الصحيحة: <b>{esc(ch.answers[0])}</b>",
            parse_mode=ParseMode.HTML,
        )
    except asyncio.CancelledError:
        pass

async def send_accept_decline(ch: Challenge, context: ContextTypes.DEFAULT_TYPE) -> None:
    kb = InlineKeyboardMarkup([[InlineKeyboardButton("✅ نعم", callback_data=f"aqe:accept:{ch.cid}"),
                                InlineKeyboardButton("❌ لا", callback_data=f"aqe:decline:{ch.cid}")]])
    await context.bot.send_message(ch.chat_id, invite_text(ch), reply_markup=kb, parse_mode=ParseMode.HTML)

async def create_challenge(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    m = update.effective_message
    chat = update.effective_chat
    user = update.effective_user
    if not m or not chat or not user:
        return
    if not group_chat(chat):
        await m.reply_text("هذا النظام يعمل داخل الجروبات والسوبرجروب فقط.")
        return
    if await chat_busy(chat.id):
        await m.reply_text("هناك تحدٍ جارٍ بالفعل في هذه المجموعة.")
        return

    if m.reply_to_message and m.reply_to_message.from_user:
        opp = m.reply_to_message.from_user
    else:
        u = extract_username(m.text or "")
        if not u:
            await m.reply_text("رد على رسالة الخصم أو اكتب @الاسم داخل أمر التحدي.")
            return
        row = await player_by_username(u)
        if not row:
            await m.reply_text("لم أجد هذا المستخدم في قاعدة البيانات. الأفضل الرد على رسالته مباشرة.")
            return
        opp = type("U", (), {"id": int(row["user_id"]), "username": row["username"], "first_name": row["first_name"], "full_name": row["display_name"]})()

    if opp.id == user.id:
        await m.reply_text("لا يمكنك تحدي نفسك.")
        return
    if getattr(opp, "is_bot", False):
        await m.reply_text("لا يمكن تحدي بوت.")
        return

    body = extract_cmd_body(m.text or "")
    if body.lower().startswith("تحدي"):
        body = body[4:].strip()
    elif body.lower().startswith("challenge"):
        body = body[9:].strip()
    if m.reply_to_message and m.reply_to_message.from_user:
        # use full body as challenge spec
        pass
    else:
        body = re.sub(r"@([A-Za-z0-9_]{5,32})", " ", body).strip()

    mode, cat_name = parse_category(body)
    if not mode or not cat_name:
        await m.reply_text(f"لم أفهم نوع التحدي.\nالفئات: {CATEGORY_HINTS}\nمثال: !تحدي @الخصم القرآن\nأو: !تحدي @الخصم سرعة")
        return

    if mode == "speed":
        q, ans = pick_speed()
        cat_key = "speed"
    else:
        keys = [k for k, v in QUESTION_BANK.items() if v["name"] == cat_name]
        cat_key = keys[0] if keys else random.choice(CATEGORY_ORDER)
        q, ans = pick_question(cat_key)
        cat_name = QUESTION_BANK[cat_key]["name"]

    ch = Challenge(
        cid=uuid.uuid4().hex[:10],
        chat_id=chat.id,
        challenger_id=user.id,
        challenger_name=dname(user),
        opponent_id=opp.id,
        opponent_name=dname(opp),
        mode=mode,
        category_key=cat_key,
        category_name=cat_name,
        question=q,
        answers=ans,
    )
    await add_challenge(ch)
    ch.pending_task = asyncio.create_task(start_pending_timeout(ch, context))
    await send_accept_decline(ch, context)

async def accept_challenge(ch: Challenge, context: ContextTypes.DEFAULT_TYPE) -> None:
    async with ch.lock:
        if ch.resolved or ch.state != "pending":
            return
        ch.state = "active"
        ch.accepted_at = time.monotonic()

    if ch.pending_task:
        ch.pending_task.cancel()

    ok = await deduct_pair(ch)
    if not ok:
        async with ch.lock:
            ch.state = "canceled"
            ch.resolved = True
        await remove_challenge(ch.cid)
        await context.bot.send_message(ch.chat_id, "لا توجد نقاط كافية لدى أحد الطرفين، تم إلغاء التحدي.")
        return

    await exec1("UPDATE players SET challenges_accepted=challenges_accepted+1, last_seen=? WHERE user_id IN (?,?)", (int(time.time()), ch.challenger_id, ch.opponent_id))
    await context.bot.send_message(ch.chat_id, question_text(ch), parse_mode=ParseMode.HTML)
    ch.timeout_task = asyncio.create_task(start_round_timeout(ch, context))

async def decline_challenge(ch: Challenge, context: ContextTypes.DEFAULT_TYPE) -> None:
    async with ch.lock:
        if ch.resolved or ch.state != "pending":
            return
        ch.state = "canceled"
        ch.resolved = True
    if ch.pending_task:
        ch.pending_task.cancel()
    await remove_challenge(ch.cid)
    await context.bot.send_message(ch.chat_id, f"تم رفض التحدي بين {esc(ch.challenger_name)} و {esc(ch.opponent_name)}.", parse_mode=ParseMode.HTML)

async def settle_draw(ch: Challenge, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    async with ch.lock:
        if ch.resolved:
            return
        ch.state = "resolved"
        ch.resolved = True
    if ch.timeout_task:
        ch.timeout_task.cancel()
    await refund_pair(ch)
    await award_draw(ch)
    await history(ch, "tie", None)
    await remove_challenge(ch.cid)
    await context.bot.send_message(ch.chat_id, text)

async def settle_win(ch: Challenge, context: ContextTypes.DEFAULT_TYPE, winner_id: int) -> None:
    async with ch.lock:
        if ch.resolved:
            return
        ch.state = "resolved"
        ch.resolved = True
    if ch.timeout_task:
        ch.timeout_task.cancel()
    await award_win(ch, winner_id)
    await history(ch, "win", winner_id)
    await remove_challenge(ch.cid)

    wr = await player(winner_id)
    lr = await player(ch.opponent_id if winner_id == ch.challenger_id else ch.challenger_id)
    wn = wr["display_name"] if wr else "الفائز"
    ln = lr["display_name"] if lr else "الخاسر"
    wp = wr["points"] if wr else "?"
    lp = lr["points"] if lr else "?"
    await context.bot.send_message(
        ch.chat_id,
        f"🏆 الفائز: <b>{esc(wn)}</b>\n💥 خسر: <b>{esc(ln)}</b>\n\nالنقاط:\n• {esc(wn)}: <b>{wp}</b>\n• {esc(ln)}: <b>{lp}</b>",
        parse_mode=ParseMode.HTML,
    )

async def handle_answer(ch: Challenge, user, message, context: ContextTypes.DEFAULT_TYPE) -> None:
    async with ch.lock:
        if ch.resolved or ch.state != "active":
            return
        sec = ts(message.date)
        if ch.first_uid is None:
            ch.first_uid = user.id
            ch.first_second = sec

            async def finalize() -> None:
                try:
                    await asyncio.sleep(TIE_WINDOW_SECONDS)
                    tie_now = False
                    winner_now = None
                    async with ch.lock:
                        if ch.resolved:
                            return
                        tie_now = ch.tie
                        winner_now = ch.first_uid
                    if tie_now:
                        await settle_draw(ch, context, "🤝 تعادل في الإجابة.\nتمت إعادة النقاط للطرفين.")
                    elif winner_now is not None:
                        await settle_win(ch, context, winner_now)
                except asyncio.CancelledError:
                    pass

            if ch.finalize_task is None:
                ch.finalize_task = asyncio.create_task(finalize())
            return

        if user.id != ch.first_uid and user.id in {ch.challenger_id, ch.opponent_id} and ch.first_second == sec:
            ch.tie = True

# ---------------- handlers ----------------

async def on_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    u = update.effective_user
    if u:
        await ensure_player(u)
    await update.effective_message.reply_text(
        f"مرحبًا بك في {APP_NAME}.\n\n"
        "هذا بوت للمسابقات داخل الجروبات.\n"
        "اكتب /help للمساعدة.",
    )

async def on_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(help_text(), parse_mode=ParseMode.HTML)

async def on_me(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    u = update.effective_user
    if not u:
        return
    await ensure_player(u)
    r = await player(u.id)
    if not r:
        return
    await update.effective_message.reply_text(
        f"👤 <b>{esc(dname(u))}</b>\n\n"
        f"النقاط: <b>{r['points']}</b>\n"
        f"الانتصارات: <b>{r['wins']}</b>\n"
        f"الهزائم: <b>{r['losses']}</b>\n"
        f"التعادلات: <b>{r['draws']}</b>\n"
        f"عدد الألعاب: <b>{r['games']}</b>",
        parse_mode=ParseMode.HTML,
    )

async def on_top(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    rows = await top_players()
    await update.effective_message.reply_text(leader_text(rows), parse_mode=ParseMode.HTML)

async def on_new_members(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    m = update.effective_message
    if not m or not m.new_chat_members:
        return
    names = []
    for u in m.new_chat_members:
        if u.is_bot:
            continue
        await ensure_player(u)
        names.append(u.first_name or u.full_name or "عضو")
    if names:
        await m.reply_text(f"أهلًا بالعضو الجديد: {', '.join(names)}\nتم حفظ الهوية لأول مرة تلقائيًا.")

async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    if not q or not q.data:
        return
    await q.answer()
    if not q.data.startswith("aqe:"):
        return
    _, action, cid = q.data.split(":", 2)
    ch = await get_challenge(cid)
    if not ch:
        await q.answer("التحدي غير موجود أو انتهى.", show_alert=True)
        return
    u = q.from_user
    if not u:
        return
    await ensure_player(u)
    if u.id != ch.opponent_id:
        await q.answer("هذه الأزرار مخصصة للخصم فقط.", show_alert=True)
        return
    if action == "accept":
        await accept_challenge(ch, context)
    elif action == "decline":
        await decline_challenge(ch, context)

async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    m = update.effective_message
    u = update.effective_user
    chat = update.effective_chat
    if not m or not u or not chat or u.is_bot:
        return
    await ensure_player(u)
    text = (m.text or m.caption or "").strip()
    body = extract_cmd_body(text)
    body_norm = norm(body)

    if text.startswith("!"):
        if body_norm.startswith("تحدي") or body_norm.startswith("challenge"):
            await create_challenge(update, context)
            return
        if body_norm in {"نعم", "yes", "accept", "قبل"}:
            p = await pending_for(chat.id, u.id)
            if p:
                await accept_challenge(p, context)
            return
        if body_norm in {"لا", "no", "رفض", "decline"}:
            p = await pending_for(chat.id, u.id)
            if p:
                await decline_challenge(p, context)
            return
        if body_norm in {"نقاط", "point", "points", "موقعي", "profile"}:
            r = await player(u.id)
            if r:
                await m.reply_text(
                    f"👤 <b>{esc(dname(u))}</b>\n\n"
                    f"النقاط: <b>{r['points']}</b>\n"
                    f"الانتصارات: <b>{r['wins']}</b>\n"
                    f"الهزائم: <b>{r['losses']}</b>\n"
                    f"التعادلات: <b>{r['draws']}</b>\n"
                    f"عدد الألعاب: <b>{r['games']}</b>",
                    parse_mode=ParseMode.HTML,
                )
            return
        if body_norm in {"ترتيب", "leaderboard", "top", "صدارة", "لوحة"}:
            await m.reply_text(leader_text(await top_players()), parse_mode=ParseMode.HTML)
            return
        if body_norm in {"help", "مساعدة", "اوامر"}:
            await m.reply_text(help_text(), parse_mode=ParseMode.HTML)
            return

    ch = await active_for_chat(chat.id)
    if not ch or ch.resolved or ch.state != "active":
        return
    if u.id not in {ch.challenger_id, ch.opponent_id}:
        return
    if not text.startswith("."):
        return
    ans = text[1:].strip()
    if not ans:
        return
    if matches(ans, ch.answers):
        await handle_answer(ch, u, m, context)

# ---------------- app ----------------

def build_app() -> Application:
    app = ApplicationBuilder().token(BOT_TOKEN).concurrent_updates(MAX_CONCURRENT_UPDATES).build()
    app.add_handler(CommandHandler("start", on_start))
    app.add_handler(CommandHandler("help", on_help))
    app.add_handler(CommandHandler("me", on_me))
    app.add_handler(CommandHandler("profile", on_me))
    app.add_handler(CommandHandler("leaderboard", on_top))
    app.add_handler(CommandHandler("top", on_top))
    app.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, on_new_members))
    app.add_handler(CallbackQueryHandler(on_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    return app

def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("Please set BOT_TOKEN environment variable.")
    init_db()
    log.info("%s ready. DB=%s", APP_NAME, DB_PATH)
    app = build_app()
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
