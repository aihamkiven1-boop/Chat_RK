const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

// ========== الإعدادات الأساسية ==========
const PREFIX = '!';
const TARGET_GROUP = '120363407969559039@g.us';
const OWNER_NUMBER = '967776436212@s.whatsapp.net';
const USERS_DB = 'users_db.json';
const QUESTIONS_HISTORY_DB = 'questions_history.json';
const LAST_EVENT_DB = 'last_event.json';
const WEEKLY_WINNERS_DB = 'weekly_winners.json';

const sleep = ms => new Promise(res => setTimeout(res, ms));
const sendTyping = async (sock, chatId) => await sock.sendPresenceUpdate('composing', chatId);

if (!fs.existsSync('temp')) fs.mkdirSync('temp');
if (!fs.existsSync('downloads')) fs.mkdirSync('downloads');

// ========== قواعد البيانات ==========
const initDB = (filePath, defaultData = {}) => {
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
};
initDB(USERS_DB, {});
initDB(QUESTIONS_HISTORY_DB, []);
initDB(LAST_EVENT_DB, { lastEventTime: 0, lastEventType: '' });
initDB(WEEKLY_WINNERS_DB, { weekStart: Date.now() });

const getDB = (filePath) => JSON.parse(fs.readFileSync(filePath));
const saveDB = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

// ========== نظام المستخدمين والرتب الفخمة ==========
const RANKS = [
    { name: '🆕 عابر سبيل', minPoints: 0, bonus: 0 },
    { name: '🛡️ محارب مستجد', minPoints: 100, bonus: 0 },
    { name: '⚔️ كاسر الدروع', minPoints: 300, bonus: 1 },
    { name: '🏅 فارس النخبة', minPoints: 500, bonus: 2 },
    { name: '👑 جنرال المهابة', minPoints: 1000, bonus: 4 },
    { name: '🌌 إمبراطور الكون', minPoints: 2000, bonus: 6 }
];

const getRank = (points) => {
    let rank = RANKS[0];
    for (const r of RANKS) if (points >= r.minPoints) rank = r;
    return rank;
};

// ────────────── دوال إدارة الديون ──────────────
const getUser = (userId) => {
    const db = getDB(USERS_DB);
    if (!db[userId]) {
        db[userId] = {
            points: 0, warnings: 0, correctAnswers: 0, totalAttempts: 0,
            lastWin: null, birthday: null, dailyGiftClaimed: null,
            challengeWins: 0, debts: []
        };
        saveDB(USERS_DB, db);
    } else if (!db[userId].debts) {
        db[userId].debts = [];
        saveDB(USERS_DB, db);
    }
    return db[userId];
};

const updateUser = (userId, updates) => {
    const db = getDB(USERS_DB);
    if (!db[userId]) {
        db[userId] = {
            points: 0, warnings: 0, correctAnswers: 0, totalAttempts: 0,
            lastWin: null, birthday: null, dailyGiftClaimed: null,
            challengeWins: 0, debts: []
        };
    }
    if (!db[userId].debts) db[userId].debts = [];
    Object.assign(db[userId], updates);
    if (db[userId].points < 0) db[userId].points = 0;
    saveDB(USERS_DB, db);
    return db[userId];
};

const getTotalDebt = (userId) => {
    const user = getUser(userId);
    if (!user.debts || user.debts.length === 0) return 0;
    return user.debts.reduce((sum, d) => sum + d.amount, 0);
};

const addDebt = (debtorId, creditorId, amount) => {
    const debtor = getUser(debtorId);
    const existing = debtor.debts.find(d => d.creditor === creditorId);
    if (existing) {
        existing.amount += amount;
        existing.originalAmount = (existing.originalAmount || existing.amount) + amount;
    } else {
        debtor.debts.push({ creditor: creditorId, amount, originalAmount: amount });
    }
    updateUser(debtorId, { debts: debtor.debts });
};

const clearDebt = (debtorId, creditorId) => {
    const debtor = getUser(debtorId);
    if (!debtor.debts) return false;
    const before = debtor.debts.length;
    debtor.debts = debtor.debts.filter(d => d.creditor !== creditorId);
    const after = debtor.debts.length;
    if (before !== after) {
        updateUser(debtorId, { debts: debtor.debts });
        return true;
    }
    return false;
};

// ────────────── دالة إضافة النقاط (الاستقطاع التلقائي الآمن) ──────────────
const addPoints = async (sock, userId, points) => {
    const user = getUser(userId);
    const rank = getRank(user.points);
    const totalPoints = points + rank.bonus;

    let remainingForUser = totalPoints;
    if (user.debts && user.debts.length > 0) {
        const deduct = Math.ceil(totalPoints * 0.5);
        let toDeduct = deduct;
        while (toDeduct > 0 && user.debts.length > 0) {
            const debt = user.debts[0];
            const deduction = Math.min(toDeduct, debt.amount);
            
            debt.amount -= deduction;
            toDeduct -= deduction;

            const creditor = getUser(debt.creditor);
            updateUser(debt.creditor, { points: creditor.points + deduction });

            const targetJid = userId.includes('@') ? userId : `${userId}@s.whatsapp.net`;
            try {
                await sock.sendMessage(targetJid, {
                    text: `💸 تم استقطاع ${deduction} نقطة لسداد جزء من دينك لـ @${debt.creditor.split('@')[0]}`
                });
            } catch (e) {
                console.error('فشل إرسال إشعار الاستقطاع:', e.message);
            }

            if (debt.amount <= 0.01) {
                user.debts.shift();
            }
        }
        remainingForUser = totalPoints - (deduct - toDeduct);
    }

    const updated = updateUser(userId, {
        points: user.points + remainingForUser,
        debts: user.debts
    });
    return {
        ...updated,
        pointsAdded: totalPoints,
        bonusFromRank: rank.bonus,
        rank: getRank(updated.points)
    };
};

// ========== متغيرات عامة ==========
let stopBot = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
let activeGame = null;
let activeGameTimer = null;
let groupAdmins = [];
let maintenanceMode = false;
let backgroundStarted = false;

const activeChallenges = {};
const pendingChallenges = {};
const pendingBets = {};
let activeBet = null;

const PROTECTED_NUMBERS = [
    '967776436212@s.whatsapp.net',
    '967774106772@s.whatsapp.net'
];

// ========== لعبة الجاسوس (Spyfall) ==========
let spyLobbyOpen = false;
let spyLobbyPlayers = [];
let spyGame = null;

const SPY_GAME_DURATION = 5 * 60 * 1000; // 5 دقائق
const SPY_ENTRY_FEE = 5;                 // رسوم الدخول

const SPY_LOCATIONS = [
    { name: 'مستشفى', roles: ['طبيب', 'ممرض', 'مريض', 'زائر', 'إداري'] },
    { name: 'مدرسة', roles: ['معلم', 'طالب', 'مدير', 'حارس', 'مشرف'] },
    { name: 'مطعم', roles: ['طباخ', 'نادل', 'زبون', 'مدير', 'محاسب'] },
    { name: 'سينما', roles: ['مخرج', 'ممثل', 'مشاهد', 'بائع تذاكر', 'منظف'] },
    { name: 'مطار', roles: ['طيار', 'مضيفة', 'مسافر', 'موظف جوازات', 'عامل حقائب'] },
    { name: 'سفينة فضائية', roles: ['قائد', 'مهندس', 'طبيب', 'روبوت', 'عالم'] }
];

// ========== حماية من الضغط ==========
const messageTimestamps = [];
let pressurePaused = false;
let pressureTimer = null;
const PRESSURE_THRESHOLD = 12;
const PRESSURE_WINDOW = 10000;
const PRESSURE_COOLDOWN = 180000;

function checkPressure() {
    const now = Date.now();
    messageTimestamps.push(now);
    while (messageTimestamps.length && now - messageTimestamps[0] > PRESSURE_WINDOW) {
        messageTimestamps.shift();
    }
    if (messageTimestamps.length >= PRESSURE_THRESHOLD && !pressurePaused) {
        pressurePaused = true;
        if (sock) {
            sock.sendMessage(TARGET_GROUP, { text: '⚠️ *ضغط عالٍ على النظام!*\n🛑 تم إيقاف استقبال الطلبات لمدة 3 دقائق لتصحيح الوضع.\n⏳ يرجى الانتظار...' });
        }
        if (pressureTimer) clearTimeout(pressureTimer);
        pressureTimer = setTimeout(() => {
            pressurePaused = false;
            messageTimestamps.length = 0;
            if (sock) {
                sock.sendMessage(TARGET_GROUP, { text: '✅ *عاد النظام للعمل.*\n🔕 لا تقم بإرسال أوامر كثيفة حتى لا يدخل النظام في وضع الصيانة مرة أخرى.' });
            }
        }, PRESSURE_COOLDOWN);
    }
}

// ========== مساعد ترتيب الحروف المبعثرة المعقدة ==========
function scramblePhrase(phrase) {
    const cleanLetters = phrase.replace(/\s+/g, '').split('');
    for (let i = cleanLetters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cleanLetters[i], cleanLetters[j]] = [cleanLetters[j], cleanLetters[i]];
    }
    return cleanLetters.join(' - ');
}

// ========== فعاليات متنوعة مع تصنيفات مكثفة ومطورة ==========
const events = [
    {
        type: 'quran', name: '🕌 سؤال من القرآن الكريم', rules: 'أجب بشكل صحيح ودقيق.', points: 20, category: 'دينية',
        questions: [
            { q: "ما هي أطول سورة في القرآن الكريم؟", a: "البقرة" },
            { q: "ما هي السورة التي يطلق عليها قلب القرآن؟", a: "يس" },
            { q: "كم عدد سور القرآن الكريم كاملة؟", a: "114" },
            { q: "ما هي السورة التي تعدل ثلث القرآن الكريم؟", a: "الإخلاص" },
            { q: "في أي سورة توجد آية الكرسي الشريفة؟", a: "البقرة" },
            { q: "ما هي السورة الملقبة بعروس القرآن؟", a: "الرحمن" },
            { q: "ما هي أول سورة نزلت في القرآن وتبدأ بـ اقرأ؟", a: "العلق" },
            { q: "كم عدد آيات سورة الفاتحة السبع المثاني؟", a: "7" },
            { q: "ما هي السورة الكريمة التي تسمى الساهرة؟", a: "النبأ" },
            { q: "ما هي السورة التي تسمى الفاضحة لأنها فضحت المنافقين؟", a: "التوبة" },
            { q: "ما هي السورة التي تسمى القتال؟", a: "محمد" },
            { q: "ما هي السورة التي ذكرت فيها البسملة مرتين؟", a: "النمل" },
            { q: "ما هي السورة التي تخلو تماماً من حرف الميم؟", a: "الكوثر" },
            { q: "سورة يطلق عليها عروس القرآن فما هي؟", a: "الرحمن" },
            { q: "ما هي السورة التي سميت باسم كوكب؟", a: "القمر" },
            { q: "كم عدد السجدات الواردة في القرآن الكريم؟", a: "15" },
            { q: "ما هي أقصر سورة في القرآن الكريم؟", a: "الكوثر" },
            { q: "ما هي السورة التي تعدل ربع القرآن الكريم؟", a: "الكافرون" }
        ]
    },
    {
        type: 'hadith', name: '📜 من الحديث النبوي الشريف', rules: 'أكمل الفراغ باللفظ الصحيح للحديث.', points: 15, category: 'دينية',
        questions: [
            { q: "أكمل الحديث: «إنما الأعمال ...»", a: "بالنيات" },
            { q: "أكمل الحديث: «لا يؤمن أحدكم حتى يحب لأخيه ما يحب ...»", a: "لنفسه" },
            { q: "أكمل الحديث: «من حسن إسلام المرء تركه ما لا ...»", a: "يعنيه" },
            { q: "أكمل الحديث: «الحلال بين والحرام ...»", a: "بين" },
            { q: "أكمل الحديث: «بني الإسلام على ...»", a: "خمس" },
            { q: "أكمل الحديث: «الدين ...»", a: "النصيحة" },
            { q: "أكمل الحديث: «اتق الله حيثما كنت، وأتبع السيئة الحسنة ...»", a: "تمحها" },
            { q: "أكمل الحديث: «من سلك طريقاً يلتمس فيه علماً سهل الله له به طريقاً إلى ...»", a: "الجنة" },
            { q: "أكمل الحديث: «الطهور شطر ...»", a: "الإيمان" },
            { q: "أكمل الحديث: «المؤمن القوي خير وأحب إلى الله من المؤمن ...»", a: "الضعيف" }
        ]
    },
    {
        type: 'math', name: '🧮 معادلة رياضية ذكية', rules: 'احسب الناتج الإجمالي مراعياً أولويات العمليات الحسابية.', points: 15, category: 'رياضيات',
        getQuestion: () => {
            const complexMathQuestions = [
                { q: "احسب الناتج النهائي للعملية التالية: 12² - (15 × 3) + √144 = ؟", a: "111" },
                { q: "احسب الناتج النهائي للعملية التالية: (8 × 7) - (9² ÷ 9) + 2³ = ؟", a: "55" },
                { q: "احسب الناتج النهائي للعملية التالية: (25 × 4) ÷ (5² - 15) = ؟", a: "10" },
                { q: "احسب الناتج النهائي للعملية التالية: √225 + (12 × 5) - 3³ = ؟", a: "48" },
                { q: "احسب الناتج النهائي للعملية التالية: 3⁴ - (4³ ÷ 2) + √169 = ؟", a: "62" },
                { q: "احسب الناتج النهائي للعملية التالية: (144 ÷ 12)³ - 1000 = ؟", a: "728" },
                { q: "احسب الناتج النهائي للعملية التالية: 5³ - (4² × 3) + √400 = ؟", a: "97" },
                { q: "احسب الناتج النهائي للعملية التالية: (7 × 7) + 5² - (48 ÷ √64) = ؟", a: "68" },
                { q: "احسب الناتج النهائي للعملية التالية: (150 ÷ 5) × 3 - (8² - √121) = ؟", a: "37" },
                { q: "احسب الناتج النهائي للعملية التالية: √625 + (6 × 9) - 2⁵ = ؟", a: "47" }
            ];
            return complexMathQuestions[Math.floor(Math.random() * complexMathQuestions.length)];
        }
    },
    {
        type: 'scrambled', name: '🧩 الحروف المبعثرة المعقدة', rules: 'قم بإعادة ترتيب هذه الحروف المبعثرة لتكوين جملة أو عبارة كاملة مكونة من كلمتين أو ثلاث كلمات.', points: 25, category: 'حروف_مبعثرة',
        getQuestion: () => {
            const phrases = [
                { phrase: "عشيرة الأوتشيها الأسطورية", hint: "عبارة من 3 كلمات - من أنمي ناروتو" },
                { phrase: "ملك القراصنة غول دي روجر", hint: "عبارة من 5 كلمات - من أنمي ون بيس" },
                { phrase: "بوابة الموت الثامنة", hint: "عبارة من 3 كلمات - تقنية قتالية خارقة" },
                { phrase: "ملك الظلال سونغ جين وو", hint: "عبارة من 4 كلمات - بطل سولو ليفيلينغ" },
                { phrase: "تقنية الإحياء الطاهرة", hint: "عبارة من 3 كلمات - تقنية محرمة تاريخية" },
                { phrase: "العدالة المطلقة للبحرية", hint: "عبارة من 3 كلمات - شعار قوة عسكرية" },
                { phrase: "سيف الروح المقدس", hint: "عبارة من 3 كلمات - سلاح أسطوري ذو طاقة مانا" },
                { phrase: "فاكهة المطاط الشيطانية", hint: "عبارة من 3 كلمات - سر قوة لوفي" },
                { phrase: "شمس الحرية نيكا", hint: "عبارة من 3 كلمات - تحول أسطوري منتظر" },
                { phrase: "صياد الرتبة الوطنية الأقوى", hint: "عبارة من 4 كلمات - رتبة صيادين خاصة" },
                { phrase: "وميض كونوها الأصفر", hint: "عبارة من 3 كلمات - لقب الهوكاجي الرابع" },
                { phrase: "الرداء السحابي الأحمر", hint: "عبارة من 3 كلمات - ملابس منظمة الأكاتسكي الشهيرة" }
            ];
            const chosen = phrases[Math.floor(Math.random() * phrases.length)];
            return {
                q: `🧩 رتب الحروف التالية للحصول على عبارة كاملة وصحيحة:\n\n📦 الحروف المبعثرة: [ *${scramblePhrase(chosen.phrase)}* ]\n💡 تلميح: ${chosen.hint}`,
                a: chosen.phrase
            };
        }
    },
    {
        type: 'onepiece', name: '🏴‍☠️ أنمي ون بيس النخبوي', rules: 'أجب بدقة بالغة عن سؤال ون بيس التفصيلي.', points: 20, category: 'ون_بيس',
        questions: [
            { q: "من هو أول عضو انضم رسمياً لطاقم قبعة القش بعد القائد لوفي؟", a: "زورو" },
            { q: "ما هي قيمة المكافأة المالية الأولى التي وضعت على رأس مونكي دي لوفي؟", a: "30 مليون" },
            { q: "ما هو الاسم الحقيقي للأدميرال السابق الملقب بـ كوزان؟", a: "أوكيجي" },
            { q: "ما اسم السفينة الأولى والأسطورية لطاقم قبعة القش التي ودعوها بالدموع؟", a: "غوينغ ميري" },
            { q: "من هو المهندس والنجار العبقري الذي قام ببناء سفينة ثاوزند ساني؟", a: "فرانكي" },
            { q: "ما هو اسم السيف الأسطوري الذي ورثه رورونوا زورو عن صديقة طفولته الراحلة كوينا؟", a: "وادو إيتشيمونجي" },
            { q: "ما هو اللقب العسكري الشهير الذي يُعرف به نائب الأدميرال الأسطوري مونكي دي غارب؟", a: "بطل البحرية" },
            { q: "من هو قائد الأسطول الحالي لقوات البحرية بعد استقالة الأدميرال سينغوكو؟", a: "أكاينو" },
            { q: "ما هو الاسم الكامل والكامل لملك قراصنة الروكس التاريخي؟", a: "روكس دي سيبك" },
            { q: "ما اسم السلاح الأثري القديم الذي يمثل سفينة حربية عملاقة قادرة على تدمير جزر بأكملها؟", a: "بلوتون" },
            { q: "من هي الشخصية التي قامت بإعطاء لوفي قبعته القشية الشهيرة في بلدة فوشا؟", a: "شانكس" },
            { q: "ما هو اسم الفاكهة الشيطانية التي تناولها الأدميرال كيزارو؟", a: "بيكا بيكا" },
            { q: "من هو العضو الذي يمتلك منصب طبيب الطاقم في سفينة قبعة القش؟", a: "تشوبر" },
            { q: "ما هي الجائزة المالية الموضوعة على رأس اليونكو شانكس حالياً بالبيلي؟", a: "4 مليار و89 مليون" },
            { q: "من هو الساعد الأيمن لملك القراصنة غول دي روجر والملقب بـ ملك الظلام؟", a: "ريلي" }
        ]
    },
    {
        type: 'sololeveling', name: '⚔️ مانهو سولو ليفيلينغ النخبوية', rules: 'أجب عن أسئلة الصيادين والقدرات الدقيقة.', points: 20, category: 'سولو_ليفيلينغ',
        questions: [
            { q: "ما هو اللقب المهين الذي أطلق على سونغ جين وو في بداية القصة؟", a: "أضعف صياد في البشرية" },
            { q: "ما هي رتبة البوابة التي شهدت اليقظة المزدوجة التاريخية لـ سونغ جين وو؟", a: "رتبة D" },
            { q: "ما اسم أول ظل قوي برتبة فارس استدعاه سونغ جين وو من الفرسان في قلعة الشياطين؟", a: "إيغريس" },
            { q: "من هو ملك الظلال الأصلي والسابق الذي ورث البطل سونغ جين وو كامل قواه؟", a: "أوزبورن" },
            { q: "ما اسم النقابة الرسمية التي قام بتأسيسها سونغ جين وو لاحقاً بعد وصوله للرتبة S؟", a: "أهجين" },
            { q: "من هو الصياد الأمريكي الأقوى الذي يحمل رتبة سلطة وطنية ويمتلك قوى الحكام؟", a: "توماس أندريه" },
            { q: "ما اسم ملك النمل المدمر والظل المرعب الذي استدعاه جين وو من جزيرة جيجو؟", a: "بيرو" },
            { q: "ما هو الاسم الحقيقي لوالد البطل سونغ جين وو الذي اختفى داخل البوابات؟", a: "سونغ إيل هوان" },
            { q: "ما هو السلاح الخنجري الأول الذي حصل عليه جين وو كجائزة بعد هزيمة ثعبان الكاسكا؟", a: "نصل قاتل الكاسكا" },
            { q: "من هو رئيس جمعية الصيادين الكوريين الأسطوري الذي يمتلك قوة رتبة S؟", a: "غو غان هي" },
            { q: "ما هي الفئة والوظيفة القتالية التي تم تخصيص سونغ جين وو بها بعد اجتياز زنزانة تغيير الفئة؟", a: "مستدعي أرواح" },
            { q: "ما اسم السائل السحري الأسطوري الشافي الذي صنعه جين وو لعلاج والدته المريضة بالنوم الأبدي؟", a: "ماء الحياة الإلهي" }
        ]
    },
    {
        type: 'naruto', name: '🍥 أنمي ناروتو النخبوي الأسطوري', rules: 'أجب بالتفصيل عن التقنيات والعشائر والأحداث في عالم الشينوبي.', points: 20, category: 'ناروتو',
        questions: [
            { q: "ما اسم التقنية المحرمة التي اخترعها توبيراما وتسمح بإعادة استدعاء الموتى؟", a: "إيدو تينسي" },
            { q: "من هو المؤسس الفعلي والأول لمنظمة الأكاتسكي قبل أن يستولي عليها أوبيتو ومادارا؟", a: "ياهيكو" },
            { q: "ما اسم الكائن والوحش ذو الذيول التسعة الذي تم ختمه بداخل جسد ناروتو؟", a: "كوراما" },
            { q: "ما هي العين البصرية الأسطورية التي تفعلت لدى ساسكي في عينه اليسرى بنقوش مغايرة؟", a: "رينغان" },
            { q: "من هي الشخصية النسائية التاريخية التي تولت منصب الهوكاجي الخامس لكونوها؟", a: "تسونادي" },
            { q: "ما اسم السيف المرعب والمتحرك الذي يمتلكه كيسامي لامتصاص تشاكرا الأخصام؟", a: "ساميهادا" },
            { q: "ما هو اللقب الشهير الذي أطلق على الهوكاجي الرابع وميناتو ناميكازي؟", a: "وميض كونوها الأصفر" },
            { q: "من هي الشخصية التي قامت بتعليم ناروتو تقنية الراسينغان الأسطورية؟", a: "جيرايا" },
            { q: "ما هي البوابة الثامنة والأخيرة التي فتحها مايت غاي ضد يوتشيها مادارا؟", a: "بوابة الموت" },
            { q: "ما اسم التقنية البصرية الفريدة لعين كاكاشي وأوبيتو والتي تقوم بنقل الأجسام لبعد آخر؟", a: "كاموي" },
            { q: "من هي الشخصية الأسطورية التي تعتبر أم الشاكر وأصل شجرة التشاكرا في عالم ناروتو؟", a: "كاغويا" },
            { q: "ما اسم السيف الروحي الخارق الذي استخدمه إيتاتشي عبر السوسانو لختم أوروتشيمارو؟", a: "سيف توتسوكا" },
            { q: "ما هي فئة عنصر النينجوتسو التي تنتج عن دمج عنصري الماء والرياح لدى شخصية هاكو؟", a: "عنصر الجليد" },
            { q: "من هو الشينوبي الذي اشتهر بلقب (شينوبي المهابة) ومؤسس كونوها مع هاشيراما؟", a: "مادارا" },
            { q: "ما اسم القرية المخفية التي ينتمي إليها الهوكاجي والنينجا الأبطال؟", a: "كونوها" }
        ]
    },
    {
        type: 'password', name: '🔡 لعبة كلمة السر المطورة', rules: 'تلميحات متتالية تدريجياً للوصول للكلمة الضائعة.', points: 20, category: 'ألغاز',
        getQuestion: () => {
            const items = [
                { word: "شمس", hints: ["إنه نجم ملتهب ومضيء", "يشرق في ساعات النهار بوضوح", "يعطي الدفء والحرارة للكوكب", "يغيب كلياً في وقت المساء"] },
                { word: "قمر", hints: ["مخلوق سماوي يظهر واضحاً بالليل", "له أوجه متعددة كالهلال والبدر", "منير ومظلم في آن واحد علمياً", "يرتبط ارتباطاً وثيقاً بالشهر الهجري"] },
                { word: "شوكولاتة", hints: ["حلوى عالمية لذيذة ومحبوبة جداً", "تصنع أساساً من بذور الكاكاو", "لونها بني داكن أو فاتح غالباً", "يعشقها الصغار والكبار لتحفيز السعادة"] },
                { word: "نظارة", hints: ["أداة بصرية تساعد على تحسين الرؤية والتركيز", "تلبس بإحكام على العينين والأنف", "تتميز بعدسات زجاجية دقيقة ومحاطة بإطار", "تحمي العيون من الأشعة الشمسية الضارة"] },
                { word: "شلال", hints: ["مياه تتدفق بقوة هائلة من مكان مرتفع وشاهق", "منظر طبيعي خلاب وجذاب للسياح", "يسمى صوته الهادر بـ خرير الماء", "يتواجد بكثرة في مجاري الجبال والغابات الاستوائية"] },
                { word: "سجادة", hints: ["نسيج سميك يغطي الأرضيات في المنازل والقصور", "نؤدي عليها الصلوات المفروضة بخشوع واطمئنان", "تتميز بنقوش إسلامية وزخارف يدوية فريدة", "تصنع تاريخياً من الصوف الفاخر أو الحرير الطبيعي"] }
            ];
            return items[Math.floor(Math.random() * items.length)];
        }
    },
    {
        type: 'capitals', name: '🗺️ تحدي العواصم العالمية', rules: 'اكتب اسم العاصمة الصحيحة للدولة المذكورة.', points: 10, category: 'جغرافيا',
        questions: [
            { q: "ما هي عاصمة جمهورية فرنسا؟", a: "باريس" },
            { q: "ما هي عاصمة دولة اليابان؟", a: "طوكيو" },
            { q: "ما هي عاصمة جمهورية مصر العربية؟", a: "القاهرة" },
            { q: "ما هي عاصمة المملكة العربية السعودية؟", a: "الرياض" },
            { q: "ما هي عاصمة جمهورية ألمانيا الاتحادية؟", a: "برلين" },
            { q: "ما هي عاصمة دولة الهند؟", a: "نيودلهي" },
            { q: "ما هي عاصمة دولة إيطاليا؟", a: "روما" },
            { q: "ما هي عاصمة دولة كندا الكبرى؟", a: "أوتاوا" },
            { q: "ما هي عاصمة جمهورية البرازيل الاتحادية؟", a: "برازيليا" },
            { q: "ما هي عاصمة الاتحاد الأسترالي؟", a: "كانبيرا" }
        ]
    },
    {
        type: 'science', name: '🧬 المعلومات والعلوم العامة', rules: 'أجب بشكل علمي دقيق وصحيح عن السؤال.', points: 12, category: 'ثقافة',
        questions: [
            { q: "ما هو أكبر عضو حيوي ممتد في جسم الإنسان بالكامل؟", a: "الجلد" },
            { q: "كم يبلغ عدد العظام الإجمالي في هيكل الإنسان البالغ؟", a: "206" },
            { q: "ما هو الغاز الحيوي الذي تتنفسه النباتات في النهار لتقوم بالبناء الضوئي؟", a: "ثاني أكسيد الكربون" },
            { q: "ما هو أسرع حيوان بري على كوكب الأرض في المسافات القصيرة؟", a: "الفهد" },
            { q: "ما لون دم الأخطبوط في الأعماق السحيقة؟", a: "أزرق" },
            { q: "كم عدد القلوب الحيوية التي يمتلكها كائن الأخطبوط؟", a: "3" },
            { q: "ما اسم أصغر عظمة موجودة في جسد الإنسان وتحديداً في الأذن الوسطى؟", a: "الركاب" }
        ]
    }
];

const addToHistory = (question) => {
    const history = getDB(QUESTIONS_HISTORY_DB);
    history.push({ question: question.q || question, time: Date.now() });
    if (history.length > 150) history.shift();
    saveDB(QUESTIONS_HISTORY_DB, history);
};

const wasRecentlyAsked = (question) => {
    const history = getDB(QUESTIONS_HISTORY_DB);
    return history.some(h => (h.question === (question.q || question)) && (Date.now() - h.time < 3600000));
};

const saveLastEvent = (eventType) => {
    const data = getDB(LAST_EVENT_DB);
    data.lastEventTime = Date.now();
    data.lastEventType = eventType;
    saveDB(LAST_EVENT_DB, data);
};

const loadLastEvent = () => getDB(LAST_EVENT_DB);

async function sendManualEvent(sock, category = null) {
    if (activeGame || maintenanceMode || pressurePaused || (spyGame && spyGame.active)) return;
    let pool = events;
    if (category) {
        pool = events.filter(e => e.category === category || e.type === category);
        if (pool.length === 0) {
            await sock.sendMessage(TARGET_GROUP, { text: `⚠️ لا توجد فعاليات مسجلة من نوع "${category}" في النظام.` });
            return;
        }
    }
    const lastEvent = loadLastEvent();
    let availableEvents = pool.filter(e => e.type !== lastEvent.lastEventType);
    if (availableEvents.length === 0) availableEvents = pool;
    const event = availableEvents[Math.floor(Math.random() * availableEvents.length)];
    let questionObj;
    
    if (event.getQuestion) {
        let att = 0;
        do { questionObj = event.getQuestion(); att++; }
        while (wasRecentlyAsked(questionObj.q || questionObj.word) && att < 30);
    } else {
        let att = 0;
        do { questionObj = event.questions[Math.floor(Math.random() * event.questions.length)]; att++; }
        while (wasRecentlyAsked(questionObj) && att < 30);
    }

    if (event.type === 'password') {
        activeGame = { type: 'password', hints: questionObj.hints, a: questionObj.word, points: 20, currentHint: 0, name: event.name, participants: [] };
        await sock.sendMessage(TARGET_GROUP, { text: `🔡 *${event.name}* (20 نقطة)\n📋 ${event.rules}\n\n🔍 التلميح الأول (1):\n*${questionObj.hints[0]}*` });
        let hintIdx = 1;
        const hintInterval = setInterval(async () => {
            if (!activeGame || activeGame.type !== 'password') { clearInterval(hintInterval); return; }
            if (hintIdx < questionObj.hints.length) {
                activeGame.points = [20, 15, 10, 5][hintIdx] || 5;
                await sock.sendMessage(TARGET_GROUP, { text: `🔍 التلميح رقم (${hintIdx+1}): *${questionObj.hints[hintIdx]}*\nالنقاط الحالية المحتسبة الآن: ${activeGame.points}` });
                hintIdx++;
            } else clearInterval(hintInterval);
        }, 30000);
        activeGameTimer = setTimeout(async () => {
            if (activeGame?.type === 'password') {
                await sock.sendMessage(TARGET_GROUP, { text: `⏰ انتهى الوقت المحدد للفعالية دون إجابة صحيحة! كلمة السر هي: *${questionObj.word}*` });
                activeGame = null; clearInterval(hintInterval);
            }
        }, 120000);
    } else if (event.type === 'dice') {
        activeGame = { type: 'dice', q: questionObj.q, a: questionObj.a, points: 15, name: event.name, participants: [], diceWinners: [] };
        await sock.sendMessage(TARGET_GROUP, { text: `🎲 *${event.name}*\n📋 ${event.rules}\n\n${questionObj.q}\n⏱ متبقي 20 ثانية فقط للتخمين!` });
        activeGameTimer = setTimeout(async () => {
            if (activeGame?.type === 'dice') {
                const winners = activeGame.diceWinners;
                if (winners.length) {
                    const pts = Math.floor(15 / winners.length);
                    let msg = `🎉 الرقم الصحيح للنرد هو: *${activeGame.a}*\nالنخبة الفائزون الذين حصلوا على (+${pts} نقطة):\n`;
                    for (const w of winners) {
                        const u = await addPoints(sock, w, pts);
                        msg += `• @${w.split('@')[0]} (الرصيد الإجمالي الحالي: ${u.points})\n`;
                    }
                    await sock.sendMessage(TARGET_GROUP, { text: msg, mentions: winners });
                } else {
                    await sock.sendMessage(TARGET_GROUP, { text: `😅 لم ينجح أحد في تخمين رقم النرد الصحيح. الرقم الحقيقي هو: ${activeGame.a}` });
                }
                activeGame = null;
            }
        }, 20000);
    } else {
        activeGame = { type: event.type, q: questionObj.q, a: questionObj.a, points: event.points, name: event.name, participants: [] };
        await sock.sendMessage(TARGET_GROUP, { text: `🎯 *${event.name}* (${event.points} نقطة)\n📋 ${event.rules}\n\n${questionObj.q}` });
        activeGameTimer = setTimeout(async () => {
            if (activeGame?.type === event.type) {
                await sock.sendMessage(TARGET_GROUP, { text: `⏰ انتهت المهلة المحددة لحل السؤال! الإجابة الصحيحة المقبولة في النظام هي: *${activeGame.a}*` });
                activeGame = null;
            }
        }, 120000);
    }
    addToHistory(questionObj.q || questionObj.word);
    saveLastEvent(event.type);
}

async function refreshAdmins(sock) {
    try {
        const meta = await sock.groupMetadata(TARGET_GROUP);
        groupAdmins = meta.participants.filter(p => p.admin).map(p => p.id);
    } catch(e) { console.error('خطأ في جلب بيانات المشرفين:', e.message); }
}

const isAdminOrOwner = (senderId) => senderId === OWNER_NUMBER || groupAdmins.includes(senderId);

async function claimDailyGift(sock, chatId, senderId) {
    const user = getUser(senderId);
    const today = new Date().toDateString();
    if (user.dailyGiftClaimed === today) return sock.sendMessage(chatId, { text: '🎁 لقد قمت باستلام هديتك اليومية المعتمدة مسبقاً لهذا اليوم.' });
    const result = await addPoints(sock, senderId, 10);
    updateUser(senderId, { dailyGiftClaimed: today });
    await sock.sendMessage(chatId, { text: `🎁 تم تسليمك الهدية اليومية بنجاح: +10 نقاط.\nرصيدك الإجمالي الحالي في النظام: ${result.points}` });
}

async function showStats(sock, chatId, senderId) {
    const user = getUser(senderId);
    const rank = getRank(user.points);
    const rate = user.totalAttempts ? ((user.correctAnswers / user.totalAttempts) * 100).toFixed(1) : 0;
    
    let debtsMsg = '';
    if (user.debts && user.debts.length > 0) {
        debtsMsg = '\n\n📛 *الالتزامات والديون المترتبة عليك للآخرين:*\n';
        user.debts.forEach(d => {
            debtsMsg += `• @${d.creditor.split('@')[0]} يطالبك بـ ${d.amount} نقطة.\n`;
        });
    } else {
        debtsMsg = '\n\n✅ *حالة ديونك:* سجلك المالي ناصع، لا توجد عليك أي ديون مستحقة للآخرين حالياً.';
    }
    
    await sock.sendMessage(chatId, { 
        text: `📊 *الملف الإحصائي الشخصي في النظام*\n\n🏷 الرتبة الحالية: ${rank.name}\n🪙 رصيدك الإجمالي: ${user.points} نقطة\n✅ الإجابات الصحيحة الكلية: ${user.correctAnswers}\n📈 نسبة نجاح الإجابات: ${rate}%\n⚠️ الإنذارات الصادرة بحقك: ${user.warnings}/3\n⚔️ عدد انتصارات التحديات: ${user.challengeWins||0}${debtsMsg}`,
        mentions: user.debts ? user.debts.map(d => d.creditor) : []
    });
}

// ========== قاعدة بيانات بنك أسئلة التحديات الكثيفة والمنوعة ==========
const challengeBanks = {
    'دين': [
        { q: "كم عدد سور القرآن الكريم كاملة؟", a: "114" },
        { q: "ما هي الصلاة التي نؤديها بلا ركوع ولا سجود؟", a: "صلاة الجنازة" },
        { q: "من هو أول الخلفاء الراشدين في تاريخ الإسلام؟", a: "أبو بكر الصديق" },
        { q: "كم يبلغ عدد أركان الإسلام الخمسة؟", a: "5" },
        { q: "ما هي السورة الكريمة الملقبة بقلب القرآن؟", a: "يس" },
        { q: "ما هي السورة التي تعدل ثلث القرآن الكريم عند قراءتها؟", a: "الإخلاص" },
        { q: "كم عدد آيات سورة الفاتحة السبع المثاني؟", a: "7" },
        { q: "ما هي السورة التي استفتحت بآية اقرأ؟", a: "العلق" },
        { q: "من هو النبي الملقب بـ كليم الله؟", a: "موسى" },
        { q: "ما هي أطول آية في كتاب الله الكريم؟", a: "آية الدين" }
    ],
    'لغز': [
        { q: "ما هو الشيء الذي يكتب باستمرار ولا يستطيع القراءة أبداً؟", a: "القلم" },
        { q: "ما هو الشيء الذي يمتلك أسناناً كثيرة ولكنه لا يعض؟", a: "المشط" },
        { q: "يمشي ويسير طويلاً بدون قدمين، فما هو؟", a: "السحاب" },
        { q: "يسمع بوضوح بلا أذن، ويتكلم بفصاحة بلا لسان، فما هو؟", a: "الهاتف" },
        { q: "ما هو الشيء الذي يكسو كل الناس وهو عارٍ تماماً؟", a: "الإبرة" },
        { q: "ما هو الشيء الذي يزيد وينقص في نفس اللحظة باستمرار؟", a: "العمر" }
    ],
    'سرعة': [
        { q: "اكتب الكلمة التالية بسرعة فائقة ودون أخطاء: برق", a: "برق" },
        { q: "اكتب الكلمة التالية بسرعة فائقة ودون أخطاء: صاعقة", a: "صاعقة" },
        { q: "اكتب الكلمة التالية بسرعة فائقة ودون أخطاء: استغفر الله", a: "استغفر الله" },
        { q: "اكتب الجملة التالية بسرعة ودقة: سبحان الله وبحمده", a: "سبحان الله وبحمده" },
        { q: "اكتب الكلمة التالية بسرعة فائقة: مروءة", a: "مروءة" },
        { q: "اكتب الكلمة التالية بسرعة فائقة: استراتيجية", a: "استراتيجية" }
    ],
    'رياضيات': [
        { q: "احسب بدقة متناهية: 12² - (15 × 3) + √144 = ؟", a: "111" },
        { q: "احسب بدقة متناهية: (8 × 7) - (9² ÷ 9) + 2³ = ؟", a: "55" },
        { q: "احسب بدقة متناهية: (25 × 4) ÷ (5² - 15) = ؟", a: "10" },
        { q: "احسب بدقة متناهية: √225 + (12 × 5) - 3³ = ؟", a: "48" },
        { q: "احسب بدقة متناهية: 3⁴ - (4³ ÷ 2) + √169 = ؟", a: "62" }
    ],
    'جغرافيا': [
        { q: "ما هي عاصمة دولة إيطاليا التاريخية؟", a: "روما" },
        { q: "ما هي عاصمة دولة كندا الشاسعة؟", a: "أوتاوا" },
        { q: "ما هي أكبر قارة من حيث المساحة في العالم الكلي؟", a: "آسيا" },
        { q: "ما هو أطول نهر مائي ممتد في العالم الكلي؟", a: "النيل" }
    ],
    'علوم': [
        { q: "ما هو الرمز الكيميائي المعتمد علمياً للماء؟", a: "H2O" },
        { q: "كم يبلغ عدد أسنان الإنسان البالغ في وضعه الطبيعي؟", a: "32" },
        { q: "ما هو الكوكب الملقب علمياً بالكوكب الأحمر؟", a: "المريخ" }
    ],
    'فنون': [
        { q: "لوحة الموناليزا الأسطورية من رسم الفنان العبقري؟", a: "دافنشي" },
        { q: "من هو شاعر المعلقات الأول وصاحب معلقة قفا نبك؟", a: "امرؤ القيس" }
    ],
    'رياضة': [
        { q: "من هو اللاعب الأكثر تسجيلاً للأهداف في تاريخ دوري أبطال أوروبا الكلي؟", a: "كريستيانو رونالدو" },
        { q: "ما هو النادي الإسباني الأكثر تحقيقاً للقب دوري أبطال أوروبا؟", a: "ريال مدريد" },
        { q: "في أي عام ميلادي رسمي تأسس الدوري الإنجليزي الممتاز (البريميرليغ)؟", a: "1992" },
        { q: "كم عدد الفرق المتنافسة في الدوري الإسباني الدرجة الأولى (لا ليغا)؟", a: "20" },
        { q: "من هو اللاعب الأسطوري الوحيد الذي حقق كأس العالم كلاعب ومدرب؟", a: "فرانتس بيكنباور" },
        { q: "ما اسم الملعب الأسطوري الذي استضاف نهائي دوري الأبطال الدراماتيكي عام 2005؟", a: "أتاتورك" },
        { q: "أي نادٍ إيطالي عريق يمتلك الرقم القياسي لمرات الفوز بلقب الكالتشيو؟", a: "يوفنتوس" }
    ],
    'ون_بيس': [
        { q: "ما هي المكافأة الحالية لـ رورونوا زورو بعد معركة وانو الطاحنة بالبيلي؟", a: "مليار و111 مليون" },
        { q: "من هو صانع ومنفذ سفينة ثاوزند ساني لطاقم قبعة القش؟", a: "فرانكي" },
        { q: "ما هو اسم السلاح الأثري الذي يمثل سفينة حربية مدمرة؟", a: "بلوتون" }
    ],
    'سولو_ليفيلينغ': [
        { q: "ما اسم أول ظل قوي برتبة فارس استدعاه سونغ جين وو؟", a: "إيغريس" },
        { q: "من هو ملك الظلال الأصلي والسابق الذي ورث البطل سونغ جين وو كامل قواه؟", a: "أوزبورن" }
    ],
    'ناروتو': [
        { q: "ما اسم التقنية المحرمة التي اخترعها توبيراما وتسمح بإعادة استدعاء الموتى؟", a: "إيدو تينسي" },
        { q: "ما هي البوابة الثامنة والأخيرة التي فتحها مايت غاي ضد يوتشيها مادارا؟", a: "بوابة الموت" }
    ]
};

function getChallengeQuestion(category) {
    const bank = challengeBanks[category] || challengeBanks['لغز'];
    let q, att = 0;
    do {
        q = bank[Math.floor(Math.random() * bank.length)];
        att++;
    } while (wasRecentlyAsked({ q: q.q }) && att < 15);
    return q;
}

function isBlacklistedDueToDebt(userId) {
    return getTotalDebt(userId) > 100;
}

async function startChallenge(sock, chatId, challenger, challenged, category) {
    if (isBlacklistedDueToDebt(challenger) || isBlacklistedDueToDebt(challenged)) {
        return sock.sendMessage(chatId, { text: '🚫 لا يمكن بدء هذا التحدي بأمر النظام؛ أحد الطرفين مدين للآخرين بأكثر من 100 نقطة. تصفية الديون أولاً!' });
    }
    const challengerUser = getUser(challenger);
    const challengedUser = getUser(challenged);
    if (challengerUser.points < 10 || challengedUser.points < 10) {
        return sock.sendMessage(chatId, { text: '🚫 لا يمكن بدء هذا التحدي؛ يجب توفر 10 نقاط على الأقل في رصيد كلا الطرفين!' });
    }
    if (activeChallenges[challenger] || activeChallenges[challenged]) {
        return sock.sendMessage(chatId, { text: '⚠️ أحد الطرفين يخوض تحدياً نشطاً في الوقت الحالي.' });
    }
    const q = getChallengeQuestion(category);
    addToHistory({ q: q.q });
    activeChallenges[challenger] = { opponent: challenged, question: q, active: true };
    activeChallenges[challenged] = { opponent: challenger, question: q, active: true };
    await sock.sendMessage(chatId, {
        text: `⚔️ *تم إطلاق التحدي المباشر* في فئة [ *${category}* ]\n👤 المتحدي الأول: @${challenger.split('@')[0]}\n👥 المتحدي الثاني: @${challenged.split('@')[0]}\n\n❓ السؤال المطروح: *${q.q}*\n💰 الجائزة: +10 نقاط من الخاسر تضاف للفائز مباشرة.`,
        mentions: [challenger, challenged]
    });
    setTimeout(() => {
        if (activeChallenges[challenger]?.active) {
            sock.sendMessage(chatId, { text: '⏰ انتهى الوقت المحدد للتحدي دون نجاح أي من الطرفين في تقديم الإجابة الصحيحة.' });
            delete activeChallenges[challenger];
            delete activeChallenges[challenged];
        }
    }, 60000);
}

// ========== لعبة الجاسوس - الدوال الأساسية ==========
function resetSpyLobby() {
    spyLobbyOpen = false;
    spyLobbyPlayers = [];
}

function resetSpyGame() {
    if (spyGame?.timer) clearTimeout(spyGame.timer);
    spyGame = null;
}

async function openSpyLobby(sock, chatId) {
    if (spyGame && spyGame.active) {
        await sock.sendMessage(chatId, { text: '⚠️ هناك جولة نشطة من لعبة الجاسوس قيد التشغيل حالياً. انتظر نهايتها.' });
        return;
    }
    if (activeGame) {
        await sock.sendMessage(chatId, { text: '⚠️ توجد فعالية نشطة في النظام حالياً. يرجى الانتظار حتى تنتهي.' });
        return;
    }
    spyLobbyOpen = true;
    spyLobbyPlayers = [];
    await sock.sendMessage(chatId, { text: `🎭 *تم فتح باب التسجيل والانضمام للعبة الجاسوس!*\n📝 استخدم الأمر التالي للانضمام: *!انضمام*\n👥 الحد الأدنى لبدء اللعبة هو 3 لاعبين.\n💰 رسوم الاشتراك المطلوبة: ${SPY_ENTRY_FEE} نقاط من الرصيد.\nسيبدأ المشرف اللعبة فور اكتمال اللاعبين.` });
}

async function joinSpyLobby(sock, chatId, senderId) {
    if (!spyLobbyOpen) {
        await sock.sendMessage(chatId, { text: '⚠️ التسجيل مغلق حالياً. يرجى فتح اللوبي أولاً باستخدام !لعبة_الجاسوس.' });
        return;
    }
    if (spyLobbyPlayers.includes(senderId)) {
        await sock.sendMessage(chatId, { text: '⚠️ لقد قمت بالتسجيل في قائمة اللاعبين لهذه الجولة مسبقاً.' });
        return;
    }
    if (isBlacklistedDueToDebt(senderId)) {
        return sock.sendMessage(chatId, { text: `🚫 لا يمكنك المشاركة بأمر النظام؛ ديونك تجاوزت الحد المسموح به (100 نقطة). قم بسدادها أولاً!` });
    }
    const user = getUser(senderId);
    if (user.points < SPY_ENTRY_FEE) {
        return sock.sendMessage(chatId, { text: `⚠️ لا تملك رسوم التسجيل الكافية لدخول اللعبة (${SPY_ENTRY_FEE} نقاط).` });
    }
    spyLobbyPlayers.push(senderId);
    await sock.sendMessage(chatId, { text: `✅ تم تسجيل اللاعب @${senderId.split('@')[0]} بنجاح في القائمة. (عدد المسجلين الحالي: ${spyLobbyPlayers.length} لاعبين).`, mentions: [senderId] });
}

async function startSpyGame(sock, chatId, senderId, mentionedIds) {
    if (!isAdminOrOwner(senderId)) {
        await sock.sendMessage(chatId, { text: '⛔ هذا الأمر محظور وحصري لمشرفي النظام فقط.' });
        return;
    }
    if (!spyLobbyOpen) {
        await sock.sendMessage(chatId, { text: '⚠️ اللوبي مغلق حالياً. افتح التسجيل أولاً باستخدام !لعبة_الجاسوس.' });
        return;
    }
    if (mentionedIds.length < 3) {
        await sock.sendMessage(chatId, { text: '⚠️ يتطلب تشغيل اللعبة الإشارة (منشن) لثلاثة لاعبين مسجلين على الأقل.' });
        return;
    }
    const notRegistered = mentionedIds.filter(id => !spyLobbyPlayers.includes(id));
    if (notRegistered.length > 0) {
        const names = notRegistered.map(id => '@' + id.split('@')[0]).join('، ');
        await sock.sendMessage(chatId, { text: `⚠️ اللاعبون التاليون لم يقوموا بالتسجيل في اللوبي مسبقاً: ${names}`, mentions: notRegistered });
        return;
    }
    for (const id of mentionedIds) {
        if (isBlacklistedDueToDebt(id)) {
            return sock.sendMessage(chatId, { text: `🚫 لا يمكن بدء اللعبة؛ اللاعب @${id.split('@')[0]} مدين بأكثر من 100 نقطة في النظام.`, mentions: [id] });
        }
    }
    for (const id of mentionedIds) {
        const user = getUser(id);
        if (user.points < SPY_ENTRY_FEE) {
            return sock.sendMessage(chatId, { text: `⚠️ اللاعب @${id.split('@')[0]} لا يملك رسوم الدخول المقررة في النظام. تم إلغاء الجولة.`, mentions: [id] });
        }
    }

    spyLobbyOpen = false;
    const players = [...mentionedIds];
    let prizePool = 0;
    for (const id of players) {
        updateUser(id, { points: getUser(id).points - SPY_ENTRY_FEE });
        prizePool += SPY_ENTRY_FEE;
    }

    const spyIndex = Math.floor(Math.random() * players.length);
    const spyId = players[spyIndex];
    const locationObj = SPY_LOCATIONS[Math.floor(Math.random() * SPY_LOCATIONS.length)];
    const locationName = locationObj.name;
    const availableRoles = [...locationObj.roles];

    const rolesMap = new Map();
    const nonSpies = players.filter(p => p !== spyId);
    for (let i = availableRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableRoles[i], availableRoles[j]] = [availableRoles[j], availableRoles[i]];
    }
    nonSpies.forEach((playerId, idx) => {
        rolesMap.set(playerId, availableRoles[idx % availableRoles.length]);
    });

    spyGame = {
        players: players,
        spy: spyId,
        location: locationName,
        roles: rolesMap,
        accusations: new Map(),
        active: true,
        timer: null,
        prizePool: prizePool
    };

    for (const playerId of players) {
        try {
            if (playerId === spyId) {
                await sock.sendMessage(playerId, { text: '🕵️ *لقد تم اختيارك لتكون الجاسوس في هذه الجولة!*\nراقب مجرى الأسئلة والنقاشات بدقة وحاول تخمين اسم المكان الحقيقي.' });
            } else {
                const role = rolesMap.get(playerId);
                await sock.sendMessage(playerId, { text: `📍 *المكان السري لهذه الجولة هو:* ${locationName}\n👤 *دورك الشخصي:* ${role}` });
            }
        } catch (e) {
            console.error(`فشل النظام في إرسال تفاصيل الدور في رسالة خاصة إلى ${playerId}:`, e.message);
        }
    }

    await sock.sendMessage(chatId, {
        text: `🎭 *انطلقت جولة لعبة الجاسوس رسمياً بنجاح!*\n👥 اللاعبون المشاركون: ${players.map(p => '@' + p.split('@')[0]).join('، ')}\n🕵️ يوجد جاسوس مجهول يندس بينكم...\n📍 المكان معلوم لجميع النخبة ومجهول تماماً للجاسوس الخفي.\n💰 القيمة الإجمالية لجائزة الفوز: ${prizePool} نقطة.\n\n🕹️ *للجاسوس:* للتخمين، أرسل: *!تخمين [المكان]*\n🕹️ *للاعبين:* لاتهام مشتبه به، أرسل: *!اتهام @منشن*\n⏳ المدة الزمنية المتاحة للجولة: 5 دقائق كاملة.`,
        mentions: players
    });

    spyGame.timer = setTimeout(async () => {
        if (spyGame && spyGame.active) {
            const spy = spyGame.spy;
            const pool = spyGame.prizePool;
            await addPoints(sock, spy, pool);
            await sock.sendMessage(chatId, {
                text: `⏰ *انتهى الوقت الرسمي للجولة دون كشف الجاسوس!*\n🕵️ فاز الجاسوس الذكي @${spy.split('@')[0]} وحصد إجمالي الجائزة (+${pool} نقطة)!\n📍 المكان الحقيقي كان: ${spyGame.location}`,
                mentions: [spy]
            });
            resetSpyGame();
        }
    }, SPY_GAME_DURATION);
}

async function handleSpyGuess(sock, chatId, senderId, guessedPlace) {
    if (!spyGame || !spyGame.active) {
        await sock.sendMessage(chatId, { text: 'لا توجد لعبة جاسوس نشطة حالياً في النظام.' });
        return;
    }
    if (!spyGame.players.includes(senderId)) {
        await sock.sendMessage(chatId, { text: 'أنت لست من اللاعبين المسجلين في هذه الجولة.' });
        return;
    }
    if (senderId !== spyGame.spy) {
        await sock.sendMessage(chatId, { text: 'محاولة مرفوضة؛ الجاسوس فقط من يحق له تخمين اسم المكان.' });
        return;
    }

    const correctPlace = spyGame.location;
    const cleanGuess = guessedPlace.trim().toLowerCase();
    const cleanCorrect = correctPlace.trim().toLowerCase();

    if (cleanGuess === cleanCorrect) {
        await addPoints(sock, senderId, spyGame.prizePool);
        await sock.sendMessage(chatId, {
            text: `🎉 *تخمين دقيق وصحيح بالكامل!*\n🕵️ نجح الجاسوس @${senderId.split('@')[0]} في كشف المكان السري: ${correctPlace}\n🏆 فاز الجاسوس بـ +${spyGame.prizePool} نقطة كاملة!`,
            mentions: [senderId]
        });
        resetSpyGame();
    } else {
        const winners = spyGame.players.filter(p => p !== senderId);
        const share = Math.floor(spyGame.prizePool / winners.length);
        for (const w of winners) {
            await addPoints(sock, w, share);
        }
        await sock.sendMessage(chatId, {
            text: `❌ *تخمين خاطئ تماماً من الجاسوس!*\n🕵️ الجاسوس @${senderId.split('@')[0]} خمّن المكان: "${guessedPlace}"\n📍 المكان الصحيح كان: ${correctPlace}\n🏆 فاز اللاعبون النخبة بالجولة وتم توزيع الجائزة بالتساوي بينهم برصيد (+${share} نقطة لكل منهم).`,
            mentions: [senderId, ...winners]
        });
        resetSpyGame();
    }
}

async function handleSpyAccusation(sock, chatId, accuserId, accusedId) {
    if (!spyGame || !spyGame.active) {
        await sock.sendMessage(chatId, { text: 'لا توجد لعبة جاسوس نشطة حالياً.' });
        return;
    }
    if (!spyGame.players.includes(accuserId)) {
        await sock.sendMessage(chatId, { text: 'أنت لست لاعباً مسجلاً في جولة الجاسوس الحالية.' });
        return;
    }
    if (!spyGame.players.includes(accusedId)) {
        await sock.sendMessage(chatId, { text: 'العضو المشتبه به المذكور ليس لاعباً في هذه الجولة.' });
        return;
    }
    if (accuserId === accusedId) {
        await sock.sendMessage(chatId, { text: 'أنت لا تستطيع اتهام نفسك.' });
        return;
    }

    if (!spyGame.accusations.has(accusedId)) {
        spyGame.accusations.set(accusedId, new Set());
    }
    const accusersSet = spyGame.accusations.get(accusedId);

    if (accusersSet.has(accuserId)) {
        await sock.sendMessage(chatId, { text: 'لقد قمت مسبقاً بالإدلاء باتهامك وتصويتك على هذا الشخص.' });
        return;
    }

    accusersSet.add(accuserId);
    const totalPlayers = spyGame.players.length;
    const requiredVotes = totalPlayers - 1;

    await sock.sendMessage(chatId, {
        text: `🗳️ العضو @${accuserId.split('@')[0]} يتهم المشتبه به @${accusedId.split('@')[0]} بأنه الجاسوس (${accusersSet.size}/${requiredVotes} أصوات مستلمة)`,
        mentions: [accuserId, accusedId]
    });

    if (accusersSet.size >= requiredVotes) {
        if (accusedId === spyGame.spy) {
            const winners = spyGame.players.filter(p => p !== spyGame.spy);
            const share = Math.floor(spyGame.prizePool / winners.length);
            for (const w of winners) {
                await addPoints(sock, w, share);
            }
            await sock.sendMessage(chatId, {
                text: `🎯 *تم كشف وإسقاط الجاسوس بنجاح!*\n🕵️ العضو @${accusedId.split('@')[0]} كان هو الجاسوس المتخفي بالفعل.\n🏆 فاز اللاعبون النخبة وحصلوا على الجائزة كاملة برصيد (+${share} نقطة لكل منهم).`,
                mentions: [accusedId, ...winners]
            });
        } else {
            await addPoints(sock, spyGame.spy, spyGame.prizePool);
            await sock.sendMessage(chatId, {
                text: `❌ *تصويت خاطئ تماماً من النخبة!*\n@${accusedId.split('@')[0]} بريء تماماً وليس الجاسوس.\n🕵️ الجاسوس الحقيقي الماكر كان @${spyGame.spy.split('@')[0]}.\n🏆 فاز الجاسوس بالجائزة كاملة ومقدارها +${spyGame.prizePool} نقطة!`,
                mentions: [accusedId, spyGame.spy]
            });
        }
        resetSpyGame();
    }
}

async function forceStopSpyGame(sock, chatId, senderId) {
    if (!isAdminOrOwner(senderId)) {
        await sock.sendMessage(chatId, { text: '⛔ فقط مشرف النظام يمتلك صلاحية الإيقاف القسري.' });
        return;
    }
    if (!spyGame || !spyGame.active) {
        await sock.sendMessage(chatId, { text: 'لا توجد لعبة جاسوس نشطة حالياً لإيقافها.' });
        return;
    }
    resetSpyGame();
    spyLobbyOpen = false;
    spyLobbyPlayers = [];
    await sock.sendMessage(chatId, { text: '🛑 *تم إيقاف جولة لعبة الجاسوس قسرياً وبشكل كامل بواسطة المشرف.*' });
}

// ========== أنظمة التقارير التلقائية الدورية ==========
let leaderboardMsgKey = null;
async function updateLeaderboard(sock) {
    const db = getDB(USERS_DB);
    const sorted = Object.entries(db).sort((a,b) => b[1].points - a[1].points).slice(0,5);
    let msg = '🏆 *لوحة شرف الأباطرة والقادة بالنظام*\n━━━━━━━━━━━━━━━━━━━━━\n';
    sorted.forEach(([id, data], i) => {
        const userIdStr = String(id);
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        msg += `${medals[i]} @${userIdStr.split('@')[0]} - ${data.points} نقطة | الرتبة: ${getRank(data.points).name}\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━━\n🔄 تحديث تلقائي من النظام: ${new Date().toLocaleTimeString('ar-SA')}`;
    try {
        const mentions = sorted.map(s => String(s[0]));
        if (leaderboardMsgKey) {
            await sock.sendMessage(TARGET_GROUP, { edit: leaderboardMsgKey, text: msg, mentions });
        } else {
            const sent = await sock.sendMessage(TARGET_GROUP, { text: msg, mentions });
            leaderboardMsgKey = sent.key;
        }
    } catch(e) { console.error('خطأ تحديث لوحة الشرف التلقائي:', e); }
}

async function checkBirthdays(sock) {
    const today = `${new Date().getDate()}/${new Date().getMonth()+1}`;
    const db = getDB(USERS_DB);
    for (const [id, data] of Object.entries(db)) {
        const userIdStr = String(id);
        if (data.birthday === today && data.birthdayGreeted !== new Date().toDateString()) {
            await addPoints(sock, id, 30);
            updateUser(id, { birthdayGreeted: new Date().toDateString() });
            try { await sock.sendMessage(TARGET_GROUP, { text: `🎂 يهنئ النظام العضو @${userIdStr.split('@')[0]} بمناسبة عيد ميلاده السعيد! 🎁 تم منحك هدية +30 نقطة لدعم مسيرتك.`, mentions: [id] }); } catch(e) {}
        }
    }
}

async function checkWeeklyWinners(sock) {
    const data = getDB(WEEKLY_WINNERS_DB);
    if (Date.now() - data.weekStart < 7*24*60*60*1000) return;
    const db = getDB(USERS_DB);
    const sorted = Object.entries(db).sort((a,b) => b[1].points - a[1].points).slice(0,3);
    if (sorted.length) {
        const rewards = [50, 30, 20];
        let msg = '🏆 *أباطرة بطولة الأسبوع في النظام* 🏆\n━━━━━━━━━━━━━━━━━━━━━\n';
        for (let i = 0; i < sorted.length; i++) {
            const [id] = sorted[i];
            await addPoints(sock, id, rewards[i]);
            const userIdStr = String(id);
            msg += `${['🥇 المركز الأول','🥈 المركز الثاني','🥉 المركز الثالث'][i]}: @${userIdStr.split('@')[0]} وحصل على مكافأة تميز +${rewards[i]} نقطة.\n`;
        }
        await sock.sendMessage(TARGET_GROUP, { text: msg, mentions: sorted.map(s => s[0]) });
    }
    saveDB(WEEKLY_WINNERS_DB, { weekStart: Date.now() });
}

// ========== دوال حماية وأمان النظام ==========
const spamTracker = {};
function checkSpam(sender) {
    const now = Date.now();
    if (!spamTracker[sender]) spamTracker[sender] = [];
    spamTracker[sender].push(now);
    spamTracker[sender] = spamTracker[sender].filter(t => now - t < 10000);
    return spamTracker[sender].length >= 5;
}

const badWords = ['كلمة1', 'كلمة2'];
function containsBadWord(text) {
    const lowerText = text.toLowerCase();
    return badWords.some(word => lowerText.includes(word.toLowerCase()));
}

// ========== معالجة الأوامر بالكامل ==========
async function handleCommand(sock, msg, command, args) {
    const chatId = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;
    const full = args.join(' ');
    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    const typos = {
        'هديه': 'هدية', 'نقاطى': 'نقاطي', 'احصائياتى': 'احصائياتي',
        'تاريخ ميلادي': 'تاريخ_ميلادي', 'هديا': 'هدية', 'تحدا': 'تحدي',
        'تحداء': 'تحدي', 'احصاءاتي': 'احصائياتي', 'احصايياتي': 'احصائياتي',
        'ترتيب': 'توب', 'القوانين': 'القوانين', 'الاوامر': 'اوامر', 'الدليل': 'اوامر',
        'بحث': 'بحث_جاسوس', 'تخمين_جاسوس': 'بحث_جاسوس',
        'تحويل': 'تحويل', 'حوّل': 'تحويل',
        'سجل_المقرضين': 'ديوني_الخارجية', 'ديوني_الخارجية': 'ديوني_الخارجية'
    };
    if (typos[command]) command = typos[command];

    await sendTyping(sock, chatId);
    await sleep(500);

    try {
        switch(command) {
            case 'القوانين':
                await sock.sendMessage(chatId, { text: `📜 *القوانين الصارمة للجروب المعتمدة من النظام*\n━━━━━━━━━━━━━━━━━━━━━\n🚫 نشر الروابط الخارجية: حذف فوري وعقوبة خصم -20 نقطة بالإضافة لإنذار.\n🗣️ تكرار وإرسال السبام المزعج: توجيه إنذار والطرد التلقائي من النظام بعد 3 إنذارات.\n🤬 الألفاظ الخارجة والإساءة: خصم -30 نقطة وإنذار رسمي.\n🎮 محاولات التلاعب والغش: تصفير نقاطك بالكامل وإيقافك.` });
                break;

            case 'نقاطي': {
                const u = getUser(senderId);
                await sock.sendMessage(chatId, { text: `🪙 رصيدك: *${u.points}* نقطة | الرتبة الحالية: *${getRank(u.points).name}* | ⚠️ سجل إنذاراتك: ${u.warnings}/3` });
                break;
            }

            case 'توب': {
                const db = getDB(USERS_DB);
                const sorted = Object.entries(db).sort((a,b)=>b[1].points-a[1].points).slice(0,10);
                let top = '🏆 *قائمة الصفوة والأفضل في النظام* 🏆\n━━━━━━━━━━━━━━━━━━━━━\n';
                sorted.forEach(([id,d],i)=> {
                    const sid = String(id);
                    top += `${i+1}. @${sid.split('@')[0]} - الرصيد الكلي: ${d.points} نقطة.\n`;
                });
                const mentions = sorted.map(s => String(s[0]));
                await sock.sendMessage(chatId, { text: top, mentions });
                break;
            }

            case 'احصائياتي':
                await showStats(sock, chatId, senderId);
                break;

            case 'هدية':
                await claimDailyGift(sock, chatId, senderId);
                break;

            case 'تحدي':
                if (!mentionedJid) return sock.sendMessage(chatId, { text: '⚠️ لم تقم بتحديد الخصم. مثال: !تحدي @منشن [دين/لغز/سرعة/رياضيات/جغرافيا/رياضة...]' });
                if (mentionedJid === senderId) return sock.sendMessage(chatId, { text: '⚠️ لا يمكنك تحدي نفسك، ابحث عن خصم كفء.' });
                if (isBlacklistedDueToDebt(senderId) || isBlacklistedDueToDebt(mentionedJid)) {
                    return sock.sendMessage(chatId, { text: '🚫 أحد الطرفين مدين بأكثر من 100 نقطة للآخرين في النظام. لا يسمح بالتحدي قبل تصفية الديون!' });
                }
                if (getUser(senderId).points < 10 || getUser(mentionedJid).points < 10) {
                    return sock.sendMessage(chatId, { text: '🚫 كلا الطرفين يجب أن يمتلكا 10 نقاط على الأقل لبدء التحدي!' });
                }
                if (pendingChallenges[senderId] || activeChallenges[senderId]) return sock.sendMessage(chatId, { text: 'أنت تخوض تحدياً أو تملك طلباً معلقاً حالياً.' });
                if (pendingChallenges[mentionedJid] || activeChallenges[mentionedJid]) return sock.sendMessage(chatId, { text: 'الخصم المستهدف مشغول حالياً بتحدٍ آخر.' });
                
                const category = args[1] || 'لغز';
                if (!challengeBanks[category]) return sock.sendMessage(chatId, { text: '⚠️ التصنيف المدخل غير موجود في النظام. الفئات المتاحة: دين, لغز, سرعة, رياضيات, جغرافيا, علوم, فنون, رياضة, ون_بيس, سولو_ليفيلينغ, ناروتو' });
                
                pendingChallenges[mentionedJid] = {
                    challengerId: senderId,
                    category: category,
                    chatId: chatId,
                    timer: setTimeout(() => {
                        if (pendingChallenges[mentionedJid]) {
                            delete pendingChallenges[mentionedJid];
                            sock.sendMessage(chatId, { text: `⏰ انتهى الوقت المتاح؛ لم يستجب @${mentionedJid.split('@')[0]} لطلب التحدي.`, mentions: [mentionedJid] });
                        }
                    }, 60000)
                };
                await sock.sendMessage(chatId, {
                    text: `⚔️ العضو @${senderId.split('@')[0]} يوجه تحدياً مباشراً لـ @${mentionedJid.split('@')[0]} في فئة [ *${category}* ]!\n📩 للقبول أو الرفض، يرجى الرد بـ *!قبول* أو *!رفض* خلال 60 ثانية.`,
                    mentions: [senderId, mentionedJid]
                });
                break;

            case 'قبول':
                if (!pendingChallenges[senderId]) return sock.sendMessage(chatId, { text: 'لا توجد طلبات تحدي معلقة بانتظارك حالياً في النظام.' });
                const pend = pendingChallenges[senderId];
                clearTimeout(pend.timer);
                delete pendingChallenges[senderId];
                if (isBlacklistedDueToDebt(senderId) || isBlacklistedDueToDebt(pend.challengerId)) {
                    return sock.sendMessage(chatId, { text: '🚫 تم إيقاف التحدي؛ أحد الطرفين مدين بأكثر من 100 نقطة للآخرين.' });
                }
                if (getUser(senderId).points < 10 || getUser(pend.challengerId).points < 10) {
                    return sock.sendMessage(chatId, { text: '🚫 لا يمكن بدء التحدي؛ متطلب الرصيد الأدنى هو 10 نقاط لكلا الطرفين.' });
                }
                await startChallenge(sock, chatId, pend.challengerId, senderId, pend.category);
                break;

            case 'رفض':
                if (!pendingChallenges[senderId]) return sock.sendMessage(chatId, { text: 'لا يوجد طلب تحدٍ معلق بانتظارك.' });
                const rej = pendingChallenges[senderId];
                clearTimeout(rej.timer);
                delete pendingChallenges[senderId];
                await sock.sendMessage(chatId, { text: `❌ رفض @${senderId.split('@')[0]} طلب التحدي الموجه إليه بصورة رسمية.`, mentions: [senderId] });
                break;

            case 'رهان': {
                if (!mentionedJid) return sock.sendMessage(chatId, { text: '⚠️ الطريقة الصحيحة للاستخدام: !رهان @منشن [المبلغ] [الفئة]' });
                const betAmount = parseInt(args[1]);
                if (isNaN(betAmount) || betAmount <= 0) return sock.sendMessage(chatId, { text: '⚠️ يجب تحديد مبلغ رهان صحيح وموجب.' });
                if (mentionedJid === senderId) return sock.sendMessage(chatId, { text: '⚠️ غير مسموح بالرهان ضد نفسك.' });
                
                const betCategory = args[2] || 'لغز';
                if (!challengeBanks[betCategory]) return sock.sendMessage(chatId, { text: '⚠️ الفئة المحددة للرهان غير مدعومة في نظامنا.' });
                if (pendingBets[senderId] || pendingBets[mentionedJid]) return sock.sendMessage(chatId, { text: '⚠️ هناك طلب رهان نشط أو معلق بالفعل لأحد الطرفين.' });
                
                pendingBets[mentionedJid] = {
                    challengerId: senderId,
                    amount: betAmount,
                    category: betCategory,
                    chatId: chatId,
                    timer: setTimeout(() => {
                        if (pendingBets[mentionedJid]) {
                            delete pendingBets[mentionedJid];
                            sock.sendMessage(chatId, { text: `⏰ انتهت مهلة الرد التلقائي، ولم يستجب @${mentionedJid.split('@')[0]} لطلب الرهان المالي.`, mentions: [mentionedJid] });
                        }
                    }, 60000)
                };
                await sock.sendMessage(chatId, {
                    text: `💰 @${senderId.split('@')[0]} يقدم عرض رهان إلى @${mentionedJid.split('@')[0]} بمبلغ قيمته *${betAmount}* نقطة في تصنيف [ *${betCategory}* ]!\n📩 للرد الفوري، أرسل: *!قبول_رهان* أو *!رفض_رهان* خلال 60 ثانية فقط.`,
                    mentions: [senderId, mentionedJid]
                });
                break;
            }

            case 'قبول_رهان': {
                if (!pendingBets[senderId]) return sock.sendMessage(chatId, { text: 'لا توجد طلبات رهان معلقة بانتظارك.' });
                const betPend = pendingBets[senderId];
                clearTimeout(betPend.timer);
                delete pendingBets[senderId];
                await startBet(sock, chatId, betPend.challengerId, senderId, betPend.amount, betPend.category);
                break;
            }

            case 'رفض_رهان': {
                if (!pendingBets[senderId]) return sock.sendMessage(chatId, { text: 'لا يوجد طلب رهان معلق للاستجابة له.' });
                const betRej = pendingBets[senderId];
                clearTimeout(betRej.timer);
                delete pendingBets[senderId];
                await sock.sendMessage(chatId, { text: `❌ رفض @${senderId.split('@')[0]} الانخراط في الرهان المالي الموجه له.`, mentions: [senderId] });
                break;
            }

            case 'تحويل': {
                if (!mentionedJid) return sock.sendMessage(chatId, { text: '⚠️ التوجيه الصحيح للأمر: !تحويل [المبلغ] @منشن' });
                const transferAmount = parseInt(args[0]);
                if (isNaN(transferAmount) || transferAmount <= 0) return sock.sendMessage(chatId, { text: '⚠️ قيمة التحويل يجب أن تكون رقماً إيجابياً صحيحاً.' });
                if (mentionedJid === senderId) return sock.sendMessage(chatId, { text: '⚠️ لا يجوز إجراء عمليات التحويل المالي لنفسك.' });

                const sender = getUser(senderId);
                if (sender.points < transferAmount) return sock.sendMessage(chatId, { text: '⚠️ تعذر إتمام المعاملة؛ رصيدك الحالي أقل من المبلغ المطلوب للتحويل.' });

                updateUser(senderId, { points: sender.points - transferAmount });
                let remainingAfterDebt = transferAmount;
                let debtRepaid = 0;

                const senderDebts = getUser(senderId).debts;
                const debtEntry = senderDebts.find(d => d.creditor === mentionedJid);
                if (debtEntry) {
                    const repay = Math.min(transferAmount, debtEntry.amount);
                    debtEntry.amount -= repay;
                    debtRepaid = repay;
                    remainingAfterDebt = transferAmount - repay;

                    if (debtEntry.amount <= 0) {
                        const updatedDebts = senderDebts.filter(d => d.creditor !== mentionedJid);
                        updateUser(senderId, { debts: updatedDebts });
                    } else {
                        updateUser(senderId, { debts: senderDebts });
                    }
                }

                if (remainingAfterDebt > 0) {
                    const receiver = getUser(mentionedJid);
                    updateUser(mentionedJid, { points: receiver.points + remainingAfterDebt });
                }

                const transactionId = Date.now().toString(36).toUpperCase();

                let dmReceipt = `🧾 *سند معتمد ورسمي لإثبات المعاملة والتحويل المالي*\n`;
                dmReceipt += `━━━━━━━━━━━━━━━━━━━━━\n`;
                dmReceipt += `📎 *رقم السند المالي:* #${transactionId}\n`;
                dmReceipt += `📅 *تاريخ وتوقيت العملية:* ${new Date().toLocaleString('ar-SA')}\n`;
                dmReceipt += `👤 *الطرف المرسل:* @${senderId.split('@')[0]}\n`;
                dmReceipt += `👥 *الطرف المستلم للرصيد:* @${mentionedJid.split('@')[0]}\n`;
                dmReceipt += `💰 *إجمالي الرصيد المخصوم:* ${transferAmount} نقطة\n`;
                dmReceipt += `━━━━━━━━━━━━━━━━━━━━━\n`;
                if (debtRepaid > 0) {
                    dmReceipt += `🩹 *تسوية التزامات الدين:*\n`;
                    dmReceipt += `   ▫️ تم تفعيل استقطاع آمن بقيمة ${debtRepaid} نقطة لسداد مستحقات هذا الدائن.\n`;
                    if (debtEntry && debtEntry.amount > 0) {
                        dmReceipt += `   ⚠️ القيمة المتبقية من الدين الإجمالي لديه: ${debtEntry.amount} نقطة.\n`;
                    } else {
                        dmReceipt += `   ✅ تم تصفير وإغلاق ملف الدين لديه بالكامل بنجاح!\n`;
                    }
                    dmReceipt += `━━━━━━━━━━━━━━━━━━━━━\n`;
                }
                dmReceipt += `💵 *الرصيد الصافي المضاف للمستلم:* ${remainingAfterDebt} نقطة.\n`;
                dmReceipt += `🪙 *رصيدك الشخصي المتبقي في النظام:* ${getUser(senderId).points} نقطة.\n`;
                dmReceipt += `━━━━━━━━━━━━━━━━━━━━━\n`;
                dmReceipt += `✨ *شاكرين استخدامك المستمر لمنصة الإدارة المالية لنظامنا الذكي.*`;

                try { 
                    await sock.sendMessage(senderId, { text: dmReceipt, mentions: [senderId, mentionedJid] }); 
                } catch(e) {
                    console.error('تعذر إرسال إيصال المعاملة عبر الخاص للمرسل:', e.message);
                }

                await sock.sendMessage(chatId, {
                    text: `💸 تم بنجاح تحويل رصيد بقيمة ${transferAmount} نقطة من @${senderId.split('@')[0]} إلى الحساب المالي لـ @${mentionedJid.split('@')[0]}.\n${debtRepaid > 0 ? `📛 تم تصفية التزامات سلف وتسديد دين بقيمة ${debtRepaid} نقطة.\n` : ''}📄 تم توليد سند رسمي بالعملية وإرساله بكافة تفاصيله إلى الخاص (DM) للطرف المرسل توثيقاً للمعاملة.`,
                    mentions: [senderId, mentionedJid]
                });
                break;
            }

            case 'سلف': {
                if (!mentionedJid) return sock.sendMessage(chatId, { text: '⚠️ التوجيه الصحيح للأمر: !سلف [المبلغ] @منشن' });
                const amount = parseInt(args[0]);
                if (isNaN(amount) || amount <= 0) return sock.sendMessage(chatId, { text: '⚠️ قيمة السلف المالي المقترحة يجب أن تكون إيجابية وصحيحة.' });
                if (mentionedJid === senderId) return sock.sendMessage(chatId, { text: '⚠️ لا يجوز إقراض نفسك.' });
                
                const lender = getUser(senderId);
                const fee = Math.ceil(amount * 0.1);
                const totalCost = amount + fee;
                
                if (lender.points < totalCost) return sock.sendMessage(chatId, { text: `⚠️ تعذر تقديم السلفة؛ رصيدك الحالي غير كافٍ. يتطلب منك توفر ${totalCost} نقطة (قيمة القرض + 10% كرسوم خدمة معتمدة للنظام).` });
                
                updateUser(senderId, { points: lender.points - totalCost });
                const borrower = getUser(mentionedJid);
                updateUser(mentionedJid, { points: borrower.points + amount });
                addDebt(mentionedJid, senderId, amount);
                
                await sock.sendMessage(chatId, {
                    text: `💸 تمت المعاملة وتسجيل السلفة المالية بنجاح!\n• المقرض المعتمد: @${senderId.split('@')[0]} أقرض @${mentionedJid.split('@')[0]} قيمة *${amount}* نقطة.\n• الخصم الإجمالي على المقرض: ${totalCost} نقطة (شامل رسوم المعالجة المحددة بـ 10%).\n• تم قيد وإثبات الدين رسمياً في سجلات الطرف المستلم @${mentionedJid.split('@')[0]}.`,
                    mentions: [senderId, mentionedJid]
                });
                break;
            }

            case 'عفو': {
                if (!mentionedJid) return sock.sendMessage(chatId, { text: '⚠️ الاستدعاء الصحيح للأمر: !عفو @منشن' });
                const debtor = getUser(mentionedJid);
                const hasDebt = debtor.debts?.some(d => d.creditor === senderId);
                if (!hasDebt) return sock.sendMessage(chatId, { text: '⚠️ العضو المشار إليه ليس مديناً لك بأي مبالغ أو نقاط حالياً.' });
                
                clearDebt(mentionedJid, senderId);
                await sock.sendMessage(chatId, {
                    text: `🤝 لفتة كريمة! عفا العضو @${senderId.split('@')[0]} بالكامل عن دين العضو @${mentionedJid.split('@')[0]}. تم إزالة الدين وإلغاء القيود عنه بنجاح في سجلات النظام.`,
                    mentions: [senderId, mentionedJid]
                });
                break;
            }

            case 'ديوني_الخارجية': {
                const allUsers = getDB(USERS_DB);
                let report = '📋 *بيان واسترداد الديون الخارجية المستحقة لك لدى الآخرين:*\n\n';
                let totalLent = 0, totalPaid = 0, totalRemaining = 0;
                let found = false;
                const mentions = [];

                for (const [debtorId, debtorData] of Object.entries(allUsers)) {
                    if (debtorData.debts && debtorData.debts.length > 0) {
                        const debtToMe = debtorData.debts.find(d => d.creditor === senderId);
                        if (debtToMe) {
                            found = true;
                            const original = debtToMe.originalAmount || debtToMe.amount;
                            const remaining = debtToMe.amount;
                            const paid = original - remaining;
                            
                            totalLent += original;
                            totalPaid += paid;
                            totalRemaining += remaining;
                            mentions.push(debtorId);

                            report += `👤 *المدين المستلف:* @${debtorId.split('@')[0]}\n`;
                            report += `   ▫️ أصل الدين المقيد: ${original} نقطة\n`;
                            report += `   ▫️ إجمالي المبلغ المسدد: ${paid} نقطة\n`;
                            report += `   ▫️ المتبقي المالي القائم: ${remaining} نقطة\n\n`;
                        }
                    }
                }
                if (!found) {
                    report += '✅ سجلك خالٍ من أي مستحقات مالية معلقة خارجياً لدى الأعضاء الآخرين.';
                } else {
                    report += `━━━━━━━━━━━━━━━━━━━━━\n📊 *الملخص والبيان الإجمالي الكلي لاستثماراتك:*\n`;
                    report += `   • إجمالي قيمة القروض المقدمة: ${totalLent} نقطة.\n`;
                    report += `   • القيمة المالية المستردة: ${totalPaid} نقطة.\n`;
                    report += `   • القيمة المالية القائمة المتبقية لك: ${totalRemaining} نقطة.\n`;
                }
                await sock.sendMessage(chatId, { text: report, mentions: mentions });
                break;
            }

            case 'اوامر': {
                const isAdmin = isAdminOrOwner(senderId);
                let cmds = `📖 *دليل الأوامر الرسمي والكامل في النظام*\n━━━━━━━━━━━━━━━━━━━━━\n\n🎮 *أوامر النخبة العامة:*\n`;
                cmds += `!نقاطي - عرض نقاطك ورتبتك وسجل إنذاراتك.\n`;
                cmds += `!احصائياتي - إحصائيات دقيقة وتفصيلية عن أدائك وسجل ديونك.\n`;
                cmds += `!هدية - استلام الهدية اليومية للنظام (+10 نقاط).\n`;
                cmds += `!توب - عرض قائمة أفضل 10 لاعبين بنقاط الصدارة في الجروب.\n`;
                cmds += `!تاريخ_ميلادي يوم/شهر - لتسجيل ميلادك السنوي واستلام جائزة عيد ميلادك.\n`;
                cmds += `!تحدي @منشن [الفئة] - تحدي مباشر ضد عضو آخر (من الفئات: دين، لغز، سرعة، رياضيات، جغرافيا، علوم، فنون، رياضة، ون_بيس، سولو_ليفيلينغ، ناروتو، حروف_مبعثرة).\n`;
                cmds += `!قبول / !رفض - للاستجابة السريعة لطلبات التحدي الموجهة إليك.\n`;
                cmds += `!رهان @منشن [المبلغ] [الفئة] - إقامة رهان نقاط ضد عضو آخر.\n`;
                cmds += `!قبول_رهان / !رفض_رهان - للرد الحاسم على طلبات الرهان مع الأعضاء.\n`;
                cmds += `!تحويل [المبلغ] @منشن - تحويل آمن لنقاط من رصيدك إلى عضو آخر مع إرسال إيصال موثق في الخاص.\n`;
                cmds += `!سلف [المبلغ] @منشن - إقراض صديق مع رسوم نظام معالجة تبلغ 10% وتقييد الدين تلقائياً.\n`;
                cmds += `!عفو @منشن - مسامحة وإسقاط دين مالي مقيد على أحد أصدقائك.\n`;
                cmds += `!ديوني_الخارجية - تقرير مالي متكامل يعرض ديونك التي لم يستردها الآخرون منك بعد.\n`;
                cmds += `!اقتراح [النص] - لإرسال مقترح مباشر لإدارة النظام (متاح من رتبة جنرال فما فوق).\n`;
                cmds += `!القوانين - عرض البنود والعقوبات المعتمدة بالجروب.\n`;
                cmds += `!اوامر - عرض هذا الدليل الإرشادي الشامل.\n\n`;
                
                cmds += `🕵️ *أوامر لعبة الجاسوس المخصصة:*\n`;
                cmds += `!لعبة_الجاسوس - لفتح التسجيل في اللوبي وبدء جمع اللاعبين.\n`;
                cmds += `!انضمام - لتسجيل الدخول في جولة الجاسوس الحالية.\n`;
                cmds += `!تخمين [المكان] - (متاح للجاسوس فقط لإنهاء الجولة بذكائه).\n`;
                cmds += `!اتهام @منشن - للتصويت والإدلاء بالشك ضد المشتبه به من اللاعبين.\n\n`;

                if (isAdmin) {
                    cmds += `🛡️ *أوامر إدارة النظام الحصرية للمشرفين:*\n`;
                    cmds += `!فعالية [التصنيف] - إطلاق فعالية ترفيهية يدوياً في الجروب.\n`;
                    cmds += `!تخطي - إلغاء الفعالية الحالية وتجاوزها.\n`;
                    cmds += `!مسح_إنذارات @منشن - مسح وتصفير سجل إنذارات العضو بشكل نهائي.\n`;
                    cmds += `!طرد @منشن - الطرد الفوري للعضو المشاغب من الجروب.\n`;
                    cmds += `!تفعيل_الفعاليات - إيقاف وضع الصيانة وتشغيل الفعاليات التلقائية للنظام.\n`;
                    cmds += `!ايقاف_الفعاليات - تشغيل الصيانة وإيقاف استقبال الفعاليات وألعاب النظام مؤقتاً.\n`;
                    cmds += `!لوحة_الشرف - تحديث لوحة الشرف للأفضل وتثبيتها بالجروب.\n`;
                    cmds += `!ابدأ_الجاسوس @اللاعبين - الإطلاق الرسمي للجولة الحالية وتوزيع الأدوار والموقع السري بالخاص.\n`;
                    cmds += `!ايقاف_اللعبه - الإيقاف الفوري والقسري لألعاب الجاسوس الجارية.`;
                }
                await sock.sendMessage(chatId, { text: cmds });
                break;
            }

            case 'اقتراح':
                if (getRank(getUser(senderId).points).minPoints < 1000 && !isAdminOrOwner(senderId)) return sock.sendMessage(chatId, { text: '👑 هذا الأمر يتطلب الحصول على رتبة "جنرال المهابة" على الأقل لتتمكن من إرسال اقتراحات للإدارة.' });
                if (!full) return sock.sendMessage(chatId, { text: 'يرجى كتابة نص الاقتراح بالكامل وبشكل واضح بعد الأمر.' });
                await sock.sendMessage(OWNER_NUMBER, { text: `💡 مقترح مرسل من @${senderId.split('@')[0]}: ${full}`, mentions: [senderId] });
                await sock.sendMessage(chatId, { text: '✅ تم استلام مقترحك بنجاح من قبل النظام وتم تحويله لمراجعة الإدارة والمالك.' });
                break;

            case 'تاريخ_ميلادي': {
                const d = args[0];
                if (!/^\d{1,2}\/\d{1,2}$/.test(d)) return sock.sendMessage(chatId, { text: '⚠️ التوجيه الصحيح للاستخدام الفعلي: تاريخ ميلادك بالتنسيق التالي: يوم/شهر (مثال: 15/4)' });
                updateUser(senderId, { birthday: d });
                await sock.sendMessage(chatId, { text: '✅ تم توثيق وحفظ تاريخ ميلادك بنجاح في قواعد بيانات النظام.' });
                break;
            }

            case 'تخطي': case 'مسح_إنذارات': case 'طرد': case 'تفعيل_الفعاليات': case 'ايقاف_الفعاليات': case 'فعالية': case 'لوحة_الشرف':
                if (!isAdminOrOwner(senderId)) return sock.sendMessage(chatId, { text: '⛔ عذراً؛ هذا الإجراء الإداري حصري للمشرفين المعتمدين في النظام.' });
                if (command === 'تخطي') {
                    clearTimeout(activeGameTimer);
                    activeGame = null;
                    await sock.sendMessage(chatId, { text: '⏭️ تم إلغاء وتخطي الفعالية النشطة الحالية بنجاح عبر تحكم المشرف.' });
                }
                else if (command === 'مسح_إنذارات') {
                    if (mentionedJid) {
                        updateUser(mentionedJid, { warnings: 0 });
                        await sock.sendMessage(chatId, { text: `✅ تم تصفير وإلغاء كافة الإنذارات الصادرة بحق العضو @${mentionedJid.split('@')[0]} بنجاح في النظام.`, mentions: [mentionedJid] });
                    } else {
                        updateUser(senderId, { warnings: 0 });
                        await sock.sendMessage(chatId, { text: '✅ تم مسح وتصفير كافة إنذاراتك الإدارية بنجاح.' });
                    }
                }
                else if (command === 'طرد') {
                    if (!mentionedJid) return sock.sendMessage(chatId, { text: '⚠️ يجب الإشارة وعمل منشن للعضو المطلوب طرده.' });
                    await sock.groupParticipantsUpdate(chatId, [mentionedJid], 'remove');
                }
                else if (command === 'تفعيل_الفعاليات') {
                    maintenanceMode = false;
                    await sock.sendMessage(chatId, { text: '✅ تم تفعيل تشغيل الفعاليات التلقائية بنجاح وإلغاء وضع الصيانة.' });
                }
                else if (command === 'ايقاف_الفعاليات') {
                    maintenanceMode = true;
                    clearTimeout(activeGameTimer);
                    activeGame = null;
                    await sock.sendMessage(chatId, { text: '🛑 تم تفعيل وضع الصيانة التام وإيقاف كافة فعاليات وألعاب النظام مؤقتاً.' });
                }
                else if (command === 'فعالية') {
                    const evCategory = args[0] || null;
                    await sendManualEvent(sock, evCategory);
                }
                else if (command === 'لوحة_الشرف') {
                    await updateLeaderboard(sock);
                }
                break;
        }
    } catch(e) { console.error('خطأ أثناء معالجة أمر المدخلات بالنظام:', e); }
}

// ========== مستمع ومعالج الرسائل الواردة ==========
function setupMessageListener(sock) {
    sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || !m.messages[0]) return;
        
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.message.protocolMessage) return;
        
        const chatId = msg.key.remoteJid;
        const senderId = msg.key.participant || msg.key.remoteJid;
        if (chatId !== TARGET_GROUP && senderId !== OWNER_NUMBER) return;
        
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        console.log(`📥 [النظام] تم تلقي رسالة بنجاح من المعرف: ${senderId} في الغرفة: ${chatId}`);

        if (chatId === TARGET_GROUP) {
            checkPressure();
            if (pressurePaused) return;
            const isProtected = PROTECTED_NUMBERS.includes(senderId);

            if (!isProtected && /(https?:\/\/[^\s]+)/.test(text)) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch(e) {}
                const user = getUser(senderId);
                const newWarns = Math.min(user.warnings + 1, 3);
                updateUser(senderId, { points: user.points - 20, warnings: newWarns });
                await sock.sendMessage(chatId, { text: `🚫 العضو @${senderId.split('@')[0]} ممنوع نشر الروابط الخارجية! عقوبة: خصم -20 نقطة وإصدار إنذار جديد لك (${newWarns}/3)`, mentions: [senderId] });
                if (newWarns >= 3) {
                    try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                }
                return;
            }

            if (!isProtected && checkSpam(senderId)) {
                const user = getUser(senderId);
                const newWarns = Math.min(user.warnings + 1, 3);
                updateUser(senderId, { warnings: newWarns });
                await sock.sendMessage(chatId, { text: `🗣️ تنبيه بالسبام المزعج! العضو @${senderId.split('@')[0]} تم رصد تدفق رسائل سريع منك؛ إصدار إنذار تلقائي لك (${newWarns}/3)`, mentions: [senderId] });
                if (newWarns >= 3) {
                    try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                }
                return;
            }

            if (!isProtected && containsBadWord(text)) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch(e) {}
                const user = getUser(senderId);
                const newWarns = Math.min(user.warnings + 1, 3);
                updateUser(senderId, { points: user.points - 30, warnings: newWarns });
                await sock.sendMessage(chatId, { text: `🤬 تم رصد استخدام لفظ محظور من العضو @${senderId.split('@')[0]}! تم حذف الرسالة، عقوبة: خصم -30 نقطة بالإضافة لإنذار (${newWarns}/3)`, mentions: [senderId] });
                if (newWarns >= 3) {
                    try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                }
                return;
            }
        }

        // معالجة الرهانات النشطة والقائمة ماليًا
        if (activeBet && (senderId === activeBet.challenger || senderId === activeBet.opponent)) {
            const correctAnswer = activeBet.question.a.toLowerCase().trim();
            if (text.trim().toLowerCase() === correctAnswer) {
                const winner = senderId;
                const result = await addPoints(sock, winner, activeBet.pool);
                await sock.sendMessage(chatId, { text: `🎉 ربح حاسم للرهان! نجح العضو العبقري @${winner.split('@')[0]} في تقديم الحل الصحيح: *${correctAnswer}* وحصد رصيد الرهان بالكامل برصيد (+${result.pointsAdded} نقطة). رصيدك الجديد الحالي: ${result.points} نقطة.`, mentions: [winner] });
                clearTimeout(activeBet.timer);
                activeBet = null;
                return;
            }
        }

        // معالجة الفعاليات المفتوحة بالنظام
        if (activeGame && !pressurePaused) {
            if (activeGame.type === 'dice') {
                if (/^[1-6]$/.test(text.trim())) {
                    if (activeGame.participants.includes(senderId)) return;
                    activeGame.participants.push(senderId);
                    if (activeGame.diceWinners.includes(senderId)) return;
                    if (text.trim() === activeGame.a) {
                        activeGame.diceWinners.push(senderId);
                    }
                }
                return;
            }
            if (activeGame.type === 'password') {
                if (text.trim().toLowerCase() === activeGame.a.toLowerCase() && !activeGame.participants.includes(senderId)) {
                    activeGame.participants.push(senderId);
                    const result = await addPoints(sock, senderId, activeGame.points);
                    updateUser(senderId, { correctAnswers: getUser(senderId).correctAnswers+1, totalAttempts: getUser(senderId).totalAttempts+1, lastWin: Date.now() });
                    await sock.sendMessage(chatId, { text: `🎉 إجابة سريعة وصحيحة تماماً! تمكن العضو النخبة @${senderId.split('@')[0]} من تخمين كلمة السر الصحيحة وتلقى رصيداً بقيمة (+${result.pointsAdded} نقطة) في حسابه المالي.`, mentions: [senderId] });
                    clearTimeout(activeGameTimer); activeGame = null;
                }
                return;
            }
            if (text.trim().toLowerCase() === activeGame.a.toLowerCase() || text.includes(activeGame.a)) {
                if (!activeGame.participants) activeGame.participants = [];
                if (activeGame.participants.includes(senderId)) return;
                activeGame.participants.push(senderId);
                const result = await addPoints(sock, senderId, activeGame.points);
                updateUser(senderId, { correctAnswers: getUser(senderId).correctAnswers+1, totalAttempts: getUser(senderId).totalAttempts+1, lastWin: Date.now() });
                await sock.sendMessage(chatId, { text: `🎉 إجابة فائقة السرعة وصحيحة تماماً! نجح العضو @${senderId.split('@')[0]} في حل السؤال أولاً وحصل على (+${result.pointsAdded} نقطة).`, mentions: [senderId] });
                clearTimeout(activeGameTimer); activeGame = null;
                return;
            }
        }

        // معالجة تحديات 1vs1 القائمة
        if (activeChallenges[senderId]?.active) {
            const ch = activeChallenges[senderId];
            if (text.trim().toLowerCase() === ch.question.a.toLowerCase()) {
                const loser = ch.opponent;
                await addPoints(sock, senderId, 10);
                updateUser(senderId, { challengeWins: (getUser(senderId).challengeWins||0)+1 });
                updateUser(loser, { points: Math.max(0, getUser(loser).points - 10) });
                await sock.sendMessage(chatId, { text: `⚔️ حسم النزال الفوري! فاز البطل @${senderId.split('@')[0]} بالتحدي وحصل على (+10 نقاط) خصمت مباشرة من رصيد الخاسر @${loser.split('@')[0]}.`, mentions: [senderId, loser] });
                delete activeChallenges[senderId]; delete activeChallenges[loser];
                return;
            }
        }

        if (!text.startsWith(PREFIX)) return;
        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        if (cmd) await handleCommand(sock, msg, cmd, args);
    });
}

function setupGroupListener(sock) {
    sock.ev.on('group-participants.update', async (update) => {
        if (update.id !== TARGET_GROUP) return;
        await refreshAdmins(sock);
        if (update.action === 'add') {
            const newMember = update.participants[0];
            updateUser(newMember, { warnings: 0 });
            await sock.sendMessage(TARGET_GROUP, { text: `👋 مرحباً بك يا بطل @${newMember.split('@')[0]} في مجموعتنا القوية! تم تسجيل حسابك المالي والتقييمي بنجاح في قواعد بيانات النظام الحالية. أرسل *!اوامر* للبدء والاطلاع على الدليل الشامل.`, mentions: [newMember] });
        }
    });
}

function startBackgroundTasks(sock) {
    if (backgroundStarted) return;
    backgroundStarted = true;
    setInterval(() => updateLeaderboard(sock), 2 * 60 * 60 * 1000);
    setInterval(() => checkWeeklyWinners(sock), 60 * 60 * 1000);
    setInterval(() => checkBirthdays(sock), 60 * 60 * 1000);
}

let sock;
async function startBot() {
    if (stopBot) return;
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['System Platform', 'Chrome', '1.0'],
        markOnlineOnConnect: false
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    setupMessageListener(sock);
    setupGroupListener(sock);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            try {
                const qrcode = require('qrcode-terminal');
                qrcode.generate(qr, { small: true });
                console.log('\n▲ امسح كود الـ QR أعلاه لربط النظام وتوصيل الواتساب بنجاح ▲\n');
            } catch (e) {
                console.log('تم توليد كود QR لتشغيل النظام ولكن مكتبة الرسم والطباعة qrcode-terminal غائبة.');
                console.log('قم بتثبيتها عبر تشغيل الأمر: npm install qrcode-terminal');
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) { 
                console.log('🚫 تم تسجيل الخروج النهائي للنظام من الهاتف بشكل قاطع.'); 
                stopBot = true; 
                return; 
            }
            reconnectAttempts++;
            const delay = Math.min(2000 * reconnectAttempts, MAX_RECONNECT_DELAY);
            console.log(`🔌 فقدان الاتصال بالنظام؛ جاري محاولة إعادة التشغيل والربط مجدداً بعد ${delay / 1000} ثانية...`);
            setTimeout(startBot, delay);
        } else if (connection === 'open') {
            console.log('🚀 تم الاتصال بنجاح وتفعيل البنية التحتية للنظام الترفيهي المالي!');
            reconnectAttempts = 0;
            startBackgroundTasks(sock);
            refreshAdmins(sock);
            updateLeaderboard(sock);
        }
    });
}

// ========== نظام الرهانات الأساسي المطور ==========
async function startBet(sock, chatId, challenger, challenged, amount, category) {
    if (isBlacklistedDueToDebt(challenger) || isBlacklistedDueToDebt(challenged)) {
        return sock.sendMessage(chatId, { text: '🚫 تم إيقاف طلب الرهان المالي؛ أحد الطرفين مدين للآخرين بأكثر من 100 نقطة في النظام.' });
    }
    const challengerUser = getUser(challenger);
    const challengedUser = getUser(challenged);
    if (challengerUser.points < amount || challengedUser.points < amount) {
        return sock.sendMessage(chatId, { text: '🚫 تعذر بدء الرهان؛ يجب توفر قيمة مبلغ الرهان كاملة وبشكل مسبق في رصيد كلا الطرفين!' });
    }
    if (activeChallenges[challenger] || activeChallenges[challenged] || pendingChallenges[challenger] || pendingChallenges[challenged]) {
        return sock.sendMessage(chatId, { text: '⚠️ أحد أطراف الرهان منشغل حالياً بنزاع أو تحدٍ آخر.' });
    }
    if (activeBet) {
        return sock.sendMessage(chatId, { text: '⚠️ هناك رهان قائم ونشط بالنظام حالياً، يرجى الانتظار حتى حسمه بالكامل.' });
    }
    const q = getChallengeQuestion(category);
    addToHistory({ q: q.q });
    updateUser(challenger, { points: challengerUser.points - amount });
    updateUser(challenged, { points: challengedUser.points - amount });
    const pool = amount * 2;
    activeBet = {
        challenger, opponent: challenged, amount, pool, question: q, category,
        timer: setTimeout(async () => {
            if (activeBet) {
                updateUser(activeBet.challenger, { points: getUser(activeBet.challenger).points + amount });
                updateUser(activeBet.opponent, { points: getUser(activeBet.opponent).points + amount });
                await sock.sendMessage(chatId, { text: '⏰ انتهى الوقت المخصص للرهان دون تلقي أي إجابة صحيحة؛ تم إعادة المبالغ كاملة لأصحابها بنجاح.' });
                activeBet = null;
            }
        }, 60000)
    };
    await sock.sendMessage(chatId, {
        text: `💰 *انطلاق الرهان المالي بالنظام وصراع النقاط!*\n👤 المتحدي الأول: @${challenger.split('@')[0]}\n👥 المتحدي الثاني: @${challenged.split('@')[0]}\n💵 القيمة المالية من كل بطل: ${amount} نقطة (صندوق الرهان الإجمالي: ${pool} نقطة)\n📋 الفئة والمسار القتالي: ${category}\n\n❓ السؤال الحاسم للرهان هو: *${q.q}*\n⏱ أول من يقدم الحل الصحيح يلتهم الصندوق المالي بالكامل!`,
        mentions: [challenger, challenged]
    });
}

console.log('🚀 جاري تهيئة وإقلاع النظام المالي والترفيهي...');
startBot();
