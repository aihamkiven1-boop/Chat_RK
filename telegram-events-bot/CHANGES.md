# CHANGES

## الملفات المعدلة
- `app/games/speed_quiz.py`
- `app/services/scheduler_service.py`
- `app/main.py`
- `tests/test_speed_quiz.py`
- `tests/test_event_state_machine.py`
- `tests/test_scheduler_service.py`
- `tests/test_code_quality.py`
- `CHANGES.md`

## ما الذي تغيّر
- `app/games/speed_quiz.py`
  - إضافة تطبيع الحرف الفارسي `ی` إلى `ي`.
  - إضافة تطبيع الحرف الفارسي `ک` إلى `ك`.
- `app/services/scheduler_service.py`
  - تثبيت رقم السؤال المعلن عند الإغلاق اعتمادًا على السؤال المغلق نفسه.
  - جدولة الإغلاق بزمن UTC صريح بدل الاعتماد على تحويلات محلية غير لازمة.
  - تحديث عدّاد الفوز عند انتهاء الفعالية.
- `app/main.py`
  - إصلاح نقطة التشغيل المباشر لتعمل بشكل متسق مع `run_polling()`.
- `tests/test_speed_quiz.py`
  - إضافة اختبار رجوعي يثبت تكافؤ `ی/ک` مع نظيريهما العربيين.
- `tests/test_event_state_machine.py`
  - إضافة اختبار رجوعي لرقم السؤال الصحيح عند الإغلاق.
- `tests/test_scheduler_service.py`
  - إضافة اختبار للتوقيت/الجدولة.
- `tests/test_code_quality.py`
  - جعل فحص `.env` لا يمنع وجود ملف محلي.
  - التحقق من عدم تتبع `.env` في Git عند توفر المستودع.

## نتائج الاختبارات
- `python -m compileall -q app scripts tests` ✅
- `python -m pytest -q` ✅
- النتيجة النهائية قبل الأرشفة: `74 passed`

## ملاحظات
- لم يتم تضمين `.env` أو قاعدة البيانات أو ملفات السجل أو مجلدات الكاش داخل الأرشيف النهائي.
