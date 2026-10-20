# الأمن — Security

## المفتاح (BOT_TOKEN)

- ضع `BOT_TOKEN` في ملف `.env` محلي فقط.
- `.env` مضمّن في `.gitignore` ولا يُرفع إلى المستودع.
- لا تُدرج التوكن في أي ملف كود، سجل، أو قاعدة بيانات.
- لا تسجّل التوكن في مستوى السجلات إطلاقًا؛ أدوات التنسيق في `app/utils/text_utils.py` (`mask_token`) متاحة عند الحاجة للتصحيح فقط.

## ملفات غير قابلة للرفع

- `data/*.sqlite3` — قاعدة البيانات.
- `logs/*.log` — السجلات.
- `backups/*` — النسخ الاحتياطية.
- كلها ضمن `.gitignore`.

## قواعد قاعدة البيانات

- كل أوامر SQL **parameterized**؛ لا يُستخدم أي string interpolation من قيم المستخدم.
- `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`.
- معاملات قصيرة عبر `Database.transaction()`.
- منع الإجابة المكررة بقيود SQLite UNIQUE.
- حدث نشط واحد لكل مجموعة عبر فهرس فريد جزئي.

## حدود ومعالجة المدخلات

- أطوال محدودة للعنوان والسؤال والإجابة (`app/utils/validators.py`).
- `callback_data` بصيغة versioned صارمة (`v1:action:entity_id:extra`)؛ لا توضع فيه توكن أو بيانات شخصية أو نصوص أسئلة.
- إجراءات الأزرار (Start/Cancel) تتحقق من كون المستخدم مشرفًا قبل التنفيذ.
- `answer_callback_query` تُستدعى دائمًا حتى مع بيانات غير صالحة.
- `error_handler` يسجّل الخطأ ولا يكشف للمستخدم أي stack trace أو أسرار.

## الصلاحيات

- أوامر الإدارة (`/event`, `/add_demo_questions`, `/start_event`, `/cancel_event` وأزرارها) متاحة للمشرفين فقط عبر طبقة `PermissionChecker` قابلة للحقن.

## ملاحظات النموذج الأول

- SQLite مناسب لنسخة واحدة/عملية واحدة (single-writer). في نسخة لاحقة بأكثر من عملية، يُنصح بالانتقال إلى قاعدة بيانات خادمية أو تنفيذ أقفال موزعة.
- لا تُستخدم شبكة غير HTTPS أبدًا لتوصيل Telegram (يستخدم البوت HTTPS عبر مكتبة python-telegram-bot).
- تأكد من تشغيل البوت بمستخدم نظام غير مرفوع الصلاحيات (غير root) في الإنتاج.
