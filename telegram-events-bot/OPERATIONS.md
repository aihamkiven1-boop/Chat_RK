# التشغيل — Operations

## إعداد البيئة محليًا

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## الإعداد والتشغيل

```bash
cp .env.example .env
# حرّر .env وضع BOT_TOKEN من BotFather (انظر SECURITY.md)
python -m app
```

يستخدم البوت Long Polling فقط. البيانات تُحفظ في `data/event_bot.sqlite3`.

## تشغيل الاختبارات

```bash
pytest -q
```

## النسخ الاحتياطي والاستعادة

إنشاء نسخة (باسم يحتوي UTC timestamp، عبر SQLite backup API الآمن أثناء WAL):

```bash
python scripts/backup_database.py data/event_bot.sqlite3 backups/
```

استعادة قاعدة بيانات من نسخة:

```bash
# أوقف البوت أولًا
cp backups/event_bot_<TIMESTAMP>.sqlite3 data/event_bot.sqlite3
python -m app
```

لا تُحذف النسخ القديمة تلقائيًا.

## بيانات تجريبية

```bash
python scripts/seed_demo_event.py
```

ينشئ مجموعة/مستخدم/فعالية/5 أسئلة تجريبية محليًا دون الحاجة إلى توكن.

## النشر على VPS عبر systemd

هذا نص الخدمة (للتوضيح فقط — لا تكتبه في /etc، انسخه إلى `event-bot.service` محليًا ثم انقله كمسؤول):

```ini
[Unit]
Description=Telegram Events Bot
After=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/telegram-events-bot
ExecStart=/opt/telegram-events-bot/.venv/bin/python -m app
Restart=always
RestartSec=10
EnvironmentFile=/opt/telegram-events-bot/.env

[Install]
WantedBy=multi-user.target
```

تمكين الخدمة:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now event-bot.service
sudo systemctl status event-bot.service
sudo journalctl -u event-bot.service -f
```

## سجل وسجلات

- السجلات في `logs/bot.log` والطرفية.
- لا تُسجل التوكن ولا نصوص الإجابات في مستوى INFO.

## Termux / PRoot

Termux/PRoot مناسب للتطوير والاختبار المحلي فقط. ليس بديلًا موثوقًا عن systemd/VPS في الإنتاج: لا يوجد ضمان لاستمرار التشغيل، فترات إيقاف للطاقة، أو إعادة تشغيل تلقائي.

## Telegram و Privacy Mode (مهم للإنتاج)

- البوت يحتاج رؤية الرسائل النصية داخل المجموعة لمعالجة الإجابات.
- عطّل Group Privacy في BotFather **أو** أضِف البوت مشرفًا، ثم أعد إضافته للمجموعة إذا لزم، بحسب احتياج البوت.
- لا يمكن تغيير هذه الإعدادات برمجيًا.
