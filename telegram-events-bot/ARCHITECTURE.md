# المعمارية — Architecture

البنية: **Modular Monolith + Layered Architecture + Repository Pattern + Service Layer + State Machine + Game Strategy**.

## الطبقات واتجاه الاعتمادات

```
handlers  -->  services  -->  repositories  -->  database
                        \--->  games
main / container  -->  handlers + services initialization
```

الممنوعات المعمارية:
- `repositories -> handlers` — ممنوع.
- `repositories -> telegram` — ممنوع (لا SQL ولا Telegram داخل repositories).
- `games -> handlers` — ممنوع.
- `games -> sqlite` — ممنوع (الألعاب دوال نقية فقط).
- `handlers -> SQL مباشر` — ممنوع.

## مخطط تدفق Update

```
Telegram Update
      │
      ▼
┌─────────────┐   command?  ┌──────────────────┐
│  Handlers   │────────────▶│  CommandHandler   │
│ (thin)      │             └────────┬─────────┘
└──────┬──────┘                      │ calls
       │  text answer                ▼
       ▼                     ┌──────────────────┐
┌─────────────┐              │   EventService    │  (state machine)
│AnswerHandler│─────────────▶│  QuestionService  │
└──────┬──────┘              │  AnswerService    │
       │                     │  Leaderboard...   │
       ▼                     └────────┬─────────┘
┌─────────────┐                      │ calls
│Service Layer│                      ▼
└──────┬──────┘              ┌──────────────────┐
       │                     │  Repositories     │  (SQL parameterized)
       ▼                     └────────┬─────────┘
┌─────────────┐                      │
│   Games     │ (normalize/check)    ▼
└─────────────┘              ┌──────────────────┐
                             │      SQLite       │  (database.py)
                             └──────────────────┘

Timer flow:  JobQueue (scheduler) ──▶ QuestionCloseDispatcher
                                       │
                                       ├─▶ QuestionService.close_question
                                       ├─▶ MessageService.announce_question_result
                                       ├─▶ next question OR EventService.finish_event
```

## مخطط حالات Event

```
                  create (/event)
                         │
                         ▼
┌────────┐   ┌──────────────┐   start   ┌─────────┐   last q closed   ┌──────────┐
│ DRAFT  │──▶│ REGISTRATION │──────────▶│ RUNNING │──────────────────▶│ FINISHED │
└────────┘   └──────┬───────┘           └────┬────┘                   └──────────┘
                    │ cancel                │ next question (RUNNING -> RUNNING)
                    ▼                       │ unrecoverable error
              ┌──────────┐                  ▼
              │ CANCELLED │            ┌─────────┐
              └──────────┘            │ FAILED  │
                                      └─────────┘
```

### جدول انتقالات الحالات (المسموح فقط)

| من | إلى | الشرط |
|----|-----|-------|
| DRAFT | REGISTRATION | — |
| REGISTRATION | RUNNING | توجد أسئلة، والمستخدم مشرف |
| REGISTRATION | CANCELLED | المشرف يلغي |
| RUNNING | RUNNING | الانتقال للسؤال التالي |
| RUNNING | FINISHED | انتهاء آخر سؤال |
| RUNNING | FAILED | خطأ لا يمكن استرداده |

أي انتقال غير مسموح يرفع `InvalidStateTransitionError` (من `app.exceptions`).

## جدول الكيانات والمسؤوليات

| الكيان | الجدول | المسؤول |
|--------|--------|---------|
| مجموعة | groups | بيانات المجموعة المستقلة |
| مستخدم | users | بيانات المستخدمين |
| عضو في مجموعة | group_members | نقاط المجموعة الكلية |
| فعالية | events | دورة حياة الحدث |
| سؤال | questions | أسئلة الفعالية |
| جولة سؤال | question_runs | التوقيت والحالة النشطة |
| إجابة | answers | الإجابات والنقاط |
| مشارك | event_participants | المشاركون في الفعالية |
| نتيجة | event_scores | نقاط الفعالية |
| قفل تشغيل | bot_runtime_locks | أقفال عملية واحدة |

### جدول الأوامر والصلاحيات

| الأمر | الخدمة | الصلاحية |
|-------|--------|----------|
| /event | EventService.create_event | مشرف |
| /add_demo_questions | EventService.add_questions | مشرف |
| /start_event | EventService.start_event + Dispatcher.begin_event | مشرف |
| /cancel_event | EventService.cancel_event | مشرف |
| /status | EventService.get_active_event | الجميع |
| /points, /rank, /leaderboard | LeaderboardService | الجميع |
| رسالة نصية | AnswerService.submit_text_answer | أي عضو |

## قرارات التصميم وأسبابها

1. **قاعدة البيانات هي مصدر الحقيقة**: لا تُستخدم ذاكرة التطبيق لتخزين حالة الفعالية، لأن ذلك يتيح الاستعادة الآمنة بعد إعادة التشغيل.
2. **منع الإجابة المكررة عبر SQLite UNIQUE** على `(question_run_id, user_id)` وليس فحص Python فقط؛ الفحص Python يُستخدم للرسالة فقط.
3. **حدث نشط واحد لكل مجموعة**: فهرس فريد جزئي `uq_events_one_active_per_group` يضمن ذلك على مستوى قاعدة البيانات كخط دفاع نهائي، مع فحص مسبق في الخدمة لرسالة أوضح.
4. **جولة سؤال نشطة واحدة لكل فعالية**: فهرس فريد جزئي `uq_question_runs_one_active_per_event` حيث `status='ACTIVE'`.
5. **JobQueue للتوقيت** بدل threading؛ أسماء jobs ثابتة `event:{id}:question:{run_id}:close` تمنع التكرار.
6. **الحالة الحالية تُشتق من العقدة النشطة** لا من مؤشر وحده؛ `close_question` مبني على ترتيب سؤال الجولة ليكون idempotent (إعادة الإغلاق لا تتقدم مرتين).
7. **نقاط نقية**: `scoring_service` دوال نقية قابلة للاختبار؛ لا تتطلب قاعدة بيانات.
8. **سعر السرعة يستخدم floor**: `speed_bonus = floor(50 * remaining_ratio)`؛ الحدود [100, 150].
9. **المعاملات قصيرة عبر context manager**: `Database.transaction()` قابل لإعادة الدخول (nested) للسماح للتجميع داخل معاملة واحدة للإجابة والنقاط.
10. **الوقت UTC ISO-8601** بتنسيق واحد يسمح بالمقارنة النصية الصحيحة.
11. **الصلاحية عبر Protocol قابل للحقن**: `PermissionChecker`؛ في الاختبارات `StaticPermissionChecker`، وفي الإنتاج `TelegramPermissionChecker` (get_chat_member).
12. **المؤشر `current_question_index` يُستخدم 0-based** مطابقًا لـ `order_number` لتقليل الأخطاء.

## تدفق الإجابة

```
مستخدم يرسل نصًا في المجموعة
  → AnswerHandler (يتجاهل الأوامر)
  → AnswerService.submit_text_answer(chat_id, user_id, text, now)
       معاملة واحدة (BEGIN):
         - الفعالية النشطة RUNNING؟
         - جولة نشطة؟ (status=ACTIVE)
         - now < ends_at؟
         - تطبيع وتحقق عبر اللعبة
         - حساب النقاط (scoring_service)
         - إدراج answer (UNIQUE يمنع التكرار)
         - تحديث event_scores + group_members + participants
       IntegrityError (مكرر) → رفض مفهوم
  → AnswerResult {accepted, correct, points, rejection_reason}
```

## تدفق Recovery

```
عند بدء التشغيل (post_init)
  → RecoveryService.recover()
  لكل فعالية RUNNING:
      لا توجد جولة نشطة؟
          pointer في النهاية → finish_event
          وإلا → بدء السؤال التالي وجدولته
      جولة نشطة منتهية الوقت؟
          → Dispatcher.run (إغلاق، إعلان، تقدم أو إنهاء)
      جولة نشطة لم تنتهِ؟
          → إعادة جدولة الإغلاق حتى ends_at
  idempotent:
      - لا تُمنح نقاط إضافية أبدًا (لا كتابة على scores)
      - الجدولة تمنع التكرار باسم job ثابت
      - الإغلاق المزدوج لا يتقدم بالمؤشر مرتين
```

## قواعد إضافة لعبة جديدة

1. أنشئ ملفًا في `app/games/` يرث `BaseGame` وينفذ: `game_type`, `validate_question`, `normalize_answer`, `check_answer`, `render_question`.
2. أضف القيمة إلى `GameType` في `constants.py`.
3. سجّل اللعبة في `build_default_registry()` في `game_registry.py`.
4. أضف أي حقل إضافي مطلوب (مثل `options_json`) في نموذج السؤال والـ migrations.
5. اكتب اختبارات للتطبيع والتحقق في `tests/`.
6. لا تربط اللعبة بـ handlers مباشرة؛ تمر عبر `GameRegistry` في الخدمات.

## ملاحظات تعارضات المواصفة (حلول مختارة)

- عند تعارض البساطة مع التعقيد، اخترنا الحل الأكثر أمانًا وبساطة ووثقناه هنا.
- إلغاء الفعالية متاح من **REGISTRATION فقط** وفق آلة الحالات المحددة صراحةً.
- `ا`/`أ`/`إ`/`آ` و`ى`/`ي` و`ة`/`ه` توحيد اختياري موثق في `app/games/speed_quiz.py`؛ قاعدة `ق`/`ك` و`س`/`ص` غير موحدة عمدًا لتفادي الالتباس.
