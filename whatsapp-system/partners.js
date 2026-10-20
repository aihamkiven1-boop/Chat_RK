// partners.js - محرك نزالات وبطاقات الأنمي الرقمية المطور والمستقل كلياً
const path = require('path');

// استيراد دالة تطهير النصوص العربية من ملف الأدوات المستقل
const { normalizeArabic } = require('./utils/normalizeArabic');

// استيراد بنوك الأسئلة الموسعة والتخصصية لسينكو وديث نوت من مجلداتها المفرزة
const { SCIENCE_QUESTIONS } = require('./questions/science');
const { INTELLECT_QUESTIONS } = require('./questions/intellect');

// الحالات العامة للنزالات والمجالات النشطة بالشات
let io = null;
let db = null; // [مصحح] كائن قاعدة البيانات النشط والموحد الممرر من السيرفر كـ Singleton مشارك
let dbHelpers = {};

let chatFrozen = false;
let chatFrozenUser = "";
let chatFrozenTimer = null;

const activeBuggyShields = new Set(); // حماية نقاط باجي
const activeDrStoneDomains = {}; // مجالات دكتور ستون
const activeIntelligenceDomains = {}; // مجالات ديث نوت المشتركة

// متتبعات مهارات الأنمي الجاهزة للاعتراض (Active Trap Triggers)
const activeBuggyTraps = {}; 
const activeDrStoneTraps = {};
const activeGojoTraps = {};

let activeDrStoneDomain = null;
let activeJointIntelligenceDomain = null;
let pendingChallenges = {};

// تهيئة وربط محرك الأنمي بالخادم الرئيسي لقراءة قواعد البيانات والبث اللحظي دون تكرار الاتصالات
function initPartners(socketIoInstance, databaseInstance, helpers) {
    io = socketIoInstance;
    db = databaseInstance; // [مصحح] استقبال كائن قاعدة البيانات النشط والموحد كـ Singleton مشارك تماماً لتلافي أخطاء التعارض
    dbHelpers = helpers; // { getUser, updateUser, syncPlayerUI, broadcastSystemMessage, sendPrivateNotification, connectedSockets, pendingChallenges, addPoints }
    pendingChallenges = helpers.pendingChallenges || {};
}

// دالة لمعالجة أوامر الشراء والاستعلام والمهارات للشركاء الرقميين
async function handlePartnerCommand(username, command, args) {
    const id = username.toLowerCase().trim().replace(/^@/, '');
    const user = await dbHelpers.getUser(id, false);
    if (!user) return;

    // تجميد الشات يمنع استخدام المهارات لغير المفعل
    if (chatFrozen && chatFrozenUser !== id) return;

    switch (command) {
        case 'شراء': {
            const partnerName = (args[0] || '').toLowerCase().trim();
            const prices = { buggy: 600, drstone: 600, gojo: 600, light: 600, l: 600 };

            if (!prices[partnerName]) {
                dbHelpers.sendPrivateNotification(id, "⚠️ الشريك المكتوب غير مدرج بالنظام. الشركاء المتاحون: (buggy، drstone، gojo، light، l).");
                return;
            }

            if (user.partners[partnerName].owned) {
                dbHelpers.sendPrivateNotification(id, `⚠️ أنت تمتلك الشريك [ ${partnerName} ] بالفعل بداخل محفظتك.`);
                return;
            }

            if (user.points < prices[partnerName]) {
                dbHelpers.sendPrivateNotification(id, `⚠️ رصيدك المالي غير كافٍ لشراء ${partnerName}. تحتاج إلى ${prices[partnerName]} نقطة.`);
                return;
            }

            // الخصم وتفعيل الشريك الرقمي
            user.partners[partnerName].owned = true;
            await dbHelpers.updateUser(id, { points: user.points - prices[partnerName], partners: user.partners });
            await dbHelpers.syncPlayerUI(id);

            dbHelpers.broadcastSystemMessage(`🎉 تهانينا! قام المقاتل @${id} بشراء الشريك الرقمي الأسطوري *${partnerName}* وانضم لكتيبته العسكرية!`);
            break;
        }

        case 'شركائي': {
            let msg = `⚙️ *كتيبتك العسكرية من الشركاء الرقميين:*\n\n`;
            for (const [name, p] of Object.entries(user.partners)) {
                if (p.owned) {
                    msg += `• *${name.toUpperCase()}:* متوفر ✅\n`;
                    if (name === 'buggy') {
                        msg += `   ▫️ مهارة 1 (التبديل): نشطة | استخدامات: ${p.skill1_uses}/3\n`;
                        msg += `   ▫️ مهارة 2 (تجميد الشات): ${p.skill2_unlocked ? "نشطة 🔓" : "مغلقة 🔒"}\n`;
                        msg += `   ▫️ مهارة 3 (سرقة الجائزة): ${p.skill3_unlocked ? "نشطة 🔓" : "مغلقة 🔒"}\n`;
                        msg += `   ▫️ مهارة 4 (الدرع الحامي): ${p.skill4_unlocked ? "نشطة 🔓" : "مغلقة 🔒"}\n`;
                    } else if (name === 'drstone') {
                        msg += `   ▫️ مهارة 1 (المجال العلمي): نشطة | استخدامات: ${p.skill1_uses}/3\n`;
                        msg += `   ▫️ مهارة 2 (تضليل الكلمات): ${p.skill2_unlocked ? "نشطة 🔓" : "مغلقة 🔒"}\n`;
                    }
                } else {
                    msg += `• *${name.toUpperCase()}:* غير مملوك ❌ (السعر: 600 نقطة)\n`;
                }
            }
            dbHelpers.sendPrivateNotification(id, msg);
            break;
        }

        // ========== مهارات المهرج باجي المخادع ==========
        case 'باجي': {
            if (!user.partners.buggy.owned) {
                dbHelpers.sendPrivateNotification(id, "⚠️ أنت لا تمتلك شريك الأنمي [ باجي ] بكتيبتك.");
                return;
            }

            const skillNum = parseInt(args[0]);
            if (isNaN(skillNum) || skillNum < 1 || skillNum > 4) {
                dbHelpers.sendPrivateNotification(id, "⚠️ التنسيق المطلوب: !باجي [رقم المهارة من 1 إلى 4]");
                return;
            }

            // مهارة 1: التبديل والاختفاء (سعرها 10 نقاط)
            if (skillNum === 1) {
                if (user.points < 10) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (10 نقاط).");
                
                await dbHelpers.updateUser(id, { points: user.points - 10 });
                user.partners.buggy.skill1_uses = (user.partners.buggy.skill1_uses || 0) + 1;

                // ترقية وفتح المهارة الثانية عند تفعيل المهارة الأولى 3 مرات!
                if (user.partners.buggy.skill1_uses >= 3 && !user.partners.buggy.skill2_unlocked) {
                    user.partners.buggy.skill2_unlocked = true;
                    dbHelpers.broadcastSystemMessage(`🔓 أسطوري! نجح المقاتل @${id} في ترقية باجي وفتح المهارة الثانية (التجميد الزمني للجروب)!`);
                }
                
                await dbHelpers.updateUser(id, { partners: user.partners });
                await dbHelpers.syncPlayerUI(id);

                activeBuggyTraps[id] = { type: 'scramble', target: null };
                dbHelpers.broadcastSystemMessage(`🃏 استدعى @${id} المهرج باجي! وتم قيد فخ "التبديل والاختفاء" النشط بالجولة القادمة!`);
            }

            // مهارة 2: التجميد الزمني للجروب (سعرها 15 نقطة)
            else if (skillNum === 2) {
                if (!user.partners.buggy.skill2_unlocked) return dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. يجب استخدام المهارة الأولى 3 مرات للترقية.");
                if (user.points < 15) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (15 نقطة).");
                if (chatFrozen) return dbHelpers.sendPrivateNotification(id, "⚠️ الشات متجمد بالفعل حالياً.");

                await dbHelpers.updateUser(id, { points: user.points - 15 });
                
                // ترقية وفتح المهارة الثالثة تلقائياً عند استخدام المهارة الثانية
                user.partners.buggy.skill2_uses = (user.partners.buggy.skill2_uses || 0) + 1;
                if (user.partners.buggy.skill2_uses >= 3 && !user.partners.buggy.skill3_unlocked) {
                    user.partners.buggy.skill3_unlocked = true;
                    dbHelpers.broadcastSystemMessage(`🔓 أسطوري! نجح المقاتل @${id} في ترقية باجي وفتح المهارة الثالثة (سرقة المكافآت)!`);
                }

                await dbHelpers.updateUser(id, { partners: user.partners });
                await dbHelpers.syncPlayerUI(id);

                // تفعيل التجميد الزمني للشات لـ 30 ثانية قاطعة!
                chatFrozen = true;
                chatFrozenUser = id;
                dbHelpers.broadcastSystemMessage(`⏱️ *الوقوف الزمني المطلق لباجي!* قام @${id} بتجميد ساحة الدردشة لـ 30 ثانية رغماً عن الجميع! يسمح له وللأدمن فقط بالكتابة!`);

                chatFrozenTimer = setTimeout(() => {
                    chatFrozen = false;
                    chatFrozenUser = "";
                    dbHelpers.broadcastSystemMessage("⏳ انتهى التجميد الزمني لباجي، وعاد الشات العام للعمل للجميع بنجاح كلي.");
                }, 30 * 1000);
            }

            // مهارة 3: سرقة المكافأة المباشرة (سعرها 20 نقطة)
            else if (skillNum === 3) {
                if (!user.partners.buggy.skill3_unlocked) return dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. استخدم المهارة الثانية لترقيتها.");
                if (user.points < 20) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (20 نقطة).");

                await dbHelpers.updateUser(id, { points: user.points - 20 });

                user.partners.buggy.skill3_uses = (user.partners.buggy.skill3_uses || 0) + 1;
                if (user.partners.buggy.skill3_uses >= 3 && !user.partners.buggy.skill4_unlocked) {
                    user.partners.buggy.skill4_unlocked = true;
                    dbHelpers.broadcastSystemMessage(`🔓 أسطوري! نجح المقاتل @${id} في ترقية باجي وفتح المهارة الرابعة (درع حماية النقاط)!`);
                }

                await dbHelpers.updateUser(id, { partners: user.partners });
                await dbHelpers.syncPlayerUI(id);

                activeBuggyTraps[id] = { type: 'steal', target: null };
                dbHelpers.broadcastSystemMessage(`🃏 استدعى @${id} المهرج باجي! وتم تفعيل فخ "سرقة مكافأة الإجابة القادمة" بنجاح كلي!`);
            }

            // مهارة 4: درع حماية النقاط الفوري
            else if (skillNum === 4) {
                if (!user.partners.buggy.skill4_unlocked) return dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. استخدم المهارة الثالثة لترقيتها.");
                if (user.points < 10) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (10 نقاط).");

                await dbHelpers.updateUser(id, { points: user.points - 10 });
                await dbHelpers.syncPlayerUI(id);

                activeBuggyShields.add(id);
                dbHelpers.broadcastSystemMessage(`🛡️ قام @${id} بتركيب "درع حماية النقاط" لباجي! لن يخسر أي نقاط إذا خسر في النزالات القادمة!`);
            }
            break;
        }

        // ========== مهارات دكتور ستون / سينكو ==========
        case 'ستون': {
            if (!user.partners.drstone.owned) {
                dbHelpers.sendPrivateNotification(id, "⚠️ أنت لا تمتلك شريك الأنمي [ دكتور ستون ] بكتيبتك.");
                return;
            }

            const skillNum = parseInt(args[0]);
            if (isNaN(skillNum) || skillNum < 1 || skillNum > 2) {
                dbHelpers.sendPrivateNotification(id, "⚠️ التنسيق المطلوب: !ستون [رقم المهارة 1 أو 2]");
                return;
            }

            // مهارة 1: إطلاق المجال العلمي (السعر 15 نقطة)
            if (skillNum === 1) {
                const opponentName = (args[1] || '').toLowerCase().trim().replace(/^@/, '');
                if (!opponentName || opponentName === id) return dbHelpers.sendPrivateNotification(id, "⚠️ يرجى تحديد الخصم المستهدف، مثال: !ستون 1 يوسف");
                if (user.points < 15) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (15 نقطة).");

                const opponentObj = await dbHelpers.getUser(opponentName, false);
                if (!opponentObj || opponentObj.points < 10) return dbHelpers.sendPrivateNotification(id, "🚫 الخصم لا يملك 10 نقاط كحد أدنى لدخول المجال أو غير متصل.");

                await dbHelpers.updateUser(id, { points: user.points - 15 });
                
                user.partners.drstone.skill1_uses = (user.partners.drstone.skill1_uses || 0) + 1;
                if (user.partners.drstone.skill1_uses >= 3 && !user.partners.drstone.skill2_unlocked) {
                    user.partners.drstone.skill2_unlocked = true;
                    dbHelpers.broadcastSystemMessage(`🔓 أسطوري! نجح @${id} في ترقية دكتور ستون وفتح المهارة الثانية (تضليل الكلمات)!`);
                }

                await dbHelpers.updateUser(id, { partners: user.partners });
                await dbHelpers.syncPlayerUI(id);

                // إطلاق نزال المجال العلمي لـ دكتور ستون
                launchDrStoneScienceDomain(id, opponentName);
            }

            // مهارة 2: تضليل الكلمات وخربطة الإجابة الصحيحة (السعر 5 نقاط)
            else if (skillNum === 2) {
                if (!user.partners.drstone.skill2_unlocked) return dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. استخدم المهارة الأولى 3 مرات لترقيتها.");
                if (user.points < 5) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (5 نقاط).");

                await dbHelpers.updateUser(id, { points: user.points - 5 });
                await dbHelpers.syncPlayerUI(id);

                activeDrStoneTraps[id] = true;
                dbHelpers.broadcastSystemMessage(`🧬 استدعى @${id} دكتور ستون! وتم تفعيل فخ "تضليل الكلمات وخربطة الإجابة القادمة" بنجاح!`);
            }
            break;
        }

        // ========== مهارة ساتورو غوجو (الفراغ اللانهائي) ==========
        case 'غوجو': {
            if (!user.partners.gojo.owned) {
                dbHelpers.sendPrivateNotification(id, "⚠️ أنت لا تمتلك شريك الأنمي [ غوجو ] بكتيبتك.");
                return;
            }

            if (user.points < 10) return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم تفعيل المجال (10 نقاط).");

            await dbHelpers.updateUser(id, { points: user.points - 10 });
            await dbHelpers.syncPlayerUI(id);

            activeGojoTraps[id] = true;
            dbHelpers.broadcastSystemMessage(`🌌 *توسيع المجال: الفراغ اللانهائي لغوجو!* قام @${id} بنشر المعلومات اللانهائية لشل عقل الإجابة القادمة للخصوم!`);
            break;
        }

        // ========== مهارة ديث نوت المشتركة (لايت ضد ريوزاكي L) ==========
        case 'ذكاء': {
            const opponentName = (args[0] || '').toLowerCase().trim().replace(/^@/, '');
            if (!opponentName || opponentName === id) return dbHelpers.sendPrivateNotification(id, "⚠️ يرجى تحديد الخصم المستهدف، مثال: !ذكاء يوسف");

            if (!user.partners.light.owned && !user.partners.l.owned) {
                return dbHelpers.sendPrivateNotification(id, "⚠️ يجب أن تمتلك ياغامي لايت أو ريوزاكي L لتفعيل هذا التحدي.");
            }

            const opponentObj = await dbHelpers.getUser(opponentName, false);
            if (!opponentObj || (!opponentObj.partners.light.owned && !opponentObj.partners.l.owned)) {
                return dbHelpers.sendPrivateNotification(id, "⚠️ الخصم المستهدف لا يمتلك ياغامي لايت أو ريوزاكي لفتح النزال المشترك أو غير متصل.");
            }

            // فحص تقابل الشخصيتين لفتح التحدي المشترك الفخم كلياً
            const hasOpposingKeys = (user.partners.light.owned && opponentObj.partners.l.owned) || (user.partners.l.owned && opponentObj.partners.light.owned);
            if (!hasOpposingKeys) {
                return dbHelpers.sendPrivateNotification(id, "🚫 يجب أن يمتلك أحدكما ياغامي لايت والآخر ريوزاكي L (لا يجوز تحدي نفس الشخصية).");
            }

            if (user.points < 15 || opponentObj.points < 15) {
                return dbHelpers.sendPrivateNotification(id, "🚫 النزال يتطلب رصيداً كافياً كحد أدنى (15 نقطة) لكلا الطرفين.");
            }

            // إرسال طلب المواجهة المشترك
            pendingChallenges[opponentObj.id] = {
                challengerId: id,
                category: 'joint_intellect',
                timer: setTimeout(() => {
                    if (pendingChallenges[opponentObj.id]) {
                        delete pendingChallenges[opponentObj.id];
                        dbHelpers.broadcastSystemMessage(`⏰ انتهت مهلة قبول تحدي ديث نوت العظيم المشترك من قبل @${opponentObj.id}`);
                    }
                }, 60000)
            };

            dbHelpers.broadcastSystemMessage(`🔮 *تحدي العباقرة المشترك (ديث نوت)!* أرسل @${id} طلب سحب ومواجهة العقل ضد @${opponentObj.id}!\n📩 اكتب *!قبول* للرد على السيرفر بمهلة 60 ثانية.`);
            break;
        }
    }
}

// ========== محرك وسيناريو مجال دكتور ستون العلمي المطور ==========
function launchDrStoneScienceDomain(challenger, opponent) {
    activeDrStoneDomain = {
        challenger: challenger,
        opponent: opponent,
        challengerScore: 0,
        opponentScore: 0,
        questionIndex: 0,
        questions: shuffleArray([...SCIENCE_QUESTIONS]).slice(0, 10),
        timer: null,
        answeringLocked: false // قفل منع الازدواجية والتسجيل المزدوج
    };

    dbHelpers.broadcastSystemMessage(`🧬 *توسيع المجال: المختبر العلمي لدكتور ستون!* تم سحب @${challenger} و @${opponent} لساحة نزالات العلوم!\n🧪 سيتم طرح 10 أسئلة علوم متتالية بالثواني! تأهبوا للإجابة الحية!`);
    
    setTimeout(() => {
        nextDrStoneQuestion();
    }, 5000);
}

function nextDrStoneQuestion() {
    if (!activeDrStoneDomain) return;

    const domain = activeDrStoneDomain;
    if (domain.questionIndex >= 10) {
        endDrStoneDomain();
        return;
    }

    domain.answeringLocked = false; // فك قفل السؤال الجديد لاستقبال الإجابات
    const currentQ = domain.questions[domain.questionIndex];
    dbHelpers.broadcastSystemMessage(`🧪 *المجال العلمي (السؤال ${domain.questionIndex + 1}/10):*\n❓ السؤال: *${currentQ.q}*\n⏱️ مهلة الإجابة السريعة: 15 ثانية!`);

    domain.timer = setTimeout(() => {
        domain.answeringLocked = true; // قفل استقبال الإجابات لانتهاء المهلة
        dbHelpers.broadcastSystemMessage(`❌ انتهت مهلة السؤال! الإجابة الصحيحة كانت: *${currentQ.a}*`);
        domain.questionIndex++;
        nextDrStoneQuestion();
    }, 15000);
}

async function handleDrStoneAnswer(username, text) {
    if (!activeDrStoneDomain) return false;

    const id = username.toLowerCase().trim().replace(/^@/, '');
    const domain = activeDrStoneDomain;

    if (id !== domain.challenger && id !== domain.opponent) return false;
    if (domain.answeringLocked) return false; // تجاهل الإجابة إذا تم تسجيل فائز مسبقاً بالتزامن

    const currentQ = domain.questions[domain.questionIndex];
    if (normalizeArabic(text) === normalizeArabic(currentQ.a)) {
        domain.answeringLocked = true; // قفل فوري للسؤال لمنع الازدواجية والسباقات الزمنية
        clearTimeout(domain.timer);

        if (id === domain.challenger) domain.challengerScore++;
        else domain.opponentScore++;

        dbHelpers.broadcastSystemMessage(`🎉 أصاب @${id} الإجابة الصحيحة وحصل على نقطة النزال! الرصيد الحالي بالمجال:\n• @${domain.challenger}: ${domain.challengerScore}\n• @${domain.opponent}: ${domain.opponentScore}`);
        
        domain.questionIndex++;
        setTimeout(nextDrStoneQuestion, 3000);
        return true;
    }
    return false;
}

async function endDrStoneDomain() {
    if (!activeDrStoneDomain) return;
    const domain = activeDrStoneDomain;

    let msg = `🏆 *انتهت جولة المجال العلمي لدكتور ستون!* النتيجة النهائية للنزال:\n`;
    msg += `• @${domain.challenger} (المالك): ${domain.challengerScore} نقاط صحيحة.\n`;
    msg += `• @${domain.opponent} (الخصم): ${domain.opponentScore} نقاط صحيحة.\n\n`;

    if (domain.challengerScore > domain.opponentScore) {
        await dbHelpers.addPoints(domain.challenger, 10);
        const oUser = await dbHelpers.getUser(domain.opponent, false);
        if (oUser) {
            await dbHelpers.updateUser(domain.opponent, { points: Math.max(0, oUser.points - 10) });
            await dbHelpers.syncPlayerUI(domain.opponent);
        }

        msg += `🥇 انتصر مالك دكتور ستون @${domain.challenger} وحصل على الجائزة +10 نقاط ومكافأة الساحة +5 نقاط مضافة! وتم خصم 10 نقاط من الخاسر @${domain.opponent}!`;
    } else if (domain.opponentScore > domain.challengerScore) {
        await dbHelpers.addPoints(domain.opponent, 10);
        const cUser = await dbHelpers.getUser(domain.challenger, false);
        
        // التحقق من تفعيل درع باجي لحماية نقاط المالك من الأخذ
        if (activeBuggyShields.has(domain.challenger)) {
            activeBuggyShields.delete(domain.challenger);
            msg += `🛡️ *درع المهرج باجي تصدى للخصم!* تم حماية نقاط الخسران @${domain.challenger} من السرقة!\n`;
        } else {
            if (cUser) {
                await dbHelpers.updateUser(domain.challenger, { points: Math.max(0, cUser.points - 10) });
                await dbHelpers.syncPlayerUI(domain.challenger);
            }
            msg += `🏆 انتصر الخصم @${domain.opponent} وسرق 10 نقاط من محفظة الخاسر @${domain.challenger}!`;
        }
    } else {
        msg += `🤝 تعادل عبقري ومميز في المجال! لم يخصم ولم يضاف أي رصيد للطرفين.`;
    }

    dbHelpers.broadcastSystemMessage(msg);
    activeDrStoneDomain = null;
    io.emit('statsUpdate');
}

// ========== محرك وسيناريو مجال ديث نوت الذكي المشترك (2vs2) ==========
function launchJointIntelligenceDomain(challenger, opponent) {
    activeJointIntelligenceDomain = {
        challenger: challenger,
        opponent: opponent,
        challengerScore: 0,
        opponentScore: 0,
        questionIndex: 0,
        questions: shuffleArray([...INTELLECT_QUESTIONS]).slice(0, 8),
        timer: null,
        answeringLocked: false // حماية من الازدواجية
    };

    dbHelpers.broadcastSystemMessage(`🔮 *توسيع المجال المشترك العظيم (ديث نوت)!* تم سحب العباقرة @${challenger} و @${opponent} لغرفة العقول المغلقة!\n👥 النزال التكتيكي الفوقي انطلق (2 ضد 2):\n• الفريق الأول: @${challenger} وشريكه الذكي ياغامي لايت\n• الفريق الثاني: @${opponent} وشريكه الذكي ريوزاكي L\n\n سيتم طرح 8 أسئلة عشوائية للذكاء بالثواني!`);
    
    setTimeout(() => {
        nextJointIntellectQuestion();
    }, 5000);
}

function nextJointIntellectQuestion() {
    if (!activeJointIntelligenceDomain) return;

    const domain = activeJointIntelligenceDomain;
    if (domain.questionIndex >= 8) {
        endJointIntellectDomain();
        return;
    }

    domain.answeringLocked = false; // فتح الباب للسؤال الجديد
    const currentQ = domain.questions[domain.questionIndex];
    dbHelpers.broadcastSystemMessage(`🔮 *مجال ديث نوت (السؤال ${domain.questionIndex + 1}/8):*\n❓ السؤال: *${currentQ.q}*\n⏱️ مهلة الإجابة السريعة: 15 ثانية!`);

    const isChallengerTurn = domain.questionIndex % 2 === 0; // تبادل الأدوار للمساعدين الأذكياء
    
    domain.timer = setTimeout(async () => {
        domain.answeringLocked = true; // إغلاق السؤال عند انتهاء المهلة
        const correctProb = Math.random() < 0.9; // نسبة ذكاء 90%
        if (correctProb) {
            if (isChallengerTurn) {
                domain.challengerScore++;
                dbHelpers.broadcastSystemMessage(`📓 *ياغامي لايت يكتب إجابته الذكية:* الإجابة الصحيحة هي: *${currentQ.a}* وحصل على نقطة لفريقه!`);
            } else {
                domain.opponentScore++;
                dbHelpers.broadcastSystemMessage(`🍭 *ريوزاكي L يكتب إجابته الذكية:* الإجابة الصحيحة هي: *${currentQ.a}* وحصل على نقطة لفريقه!`);
            }
            domain.questionIndex++;
            setTimeout(nextJointIntellectQuestion, 4000);
        } else {
            dbHelpers.broadcastSystemMessage(`❌ انتهت مهلة السؤال للعباقرة دون إجابة صحيحة! الإجابة كانت: *${currentQ.a}*`);
            domain.questionIndex++;
            nextJointIntellectQuestion();
        }
    }, 15000);
}

async function handleJointIntellectAnswer(username, text) {
    if (!activeJointIntelligenceDomain) return false;

    const id = username.toLowerCase().trim().replace(/^@/, '');
    const domain = activeJointIntelligenceDomain;

    if (id !== domain.challenger && id !== domain.opponent) return false;
    if (domain.answeringLocked) return false; // تجاهل الإجابات المتأخرة أو المزدوجة

    const currentQ = domain.questions[domain.questionIndex];
    if (normalizeArabic(text) === normalizeArabic(currentQ.a)) {
        domain.answeringLocked = true; // تفعيل القفل الفوري والكامل
        clearTimeout(domain.timer);

        if (id === domain.challenger) domain.challengerScore++;
        else domain.opponentScore++;

        dbHelpers.broadcastSystemMessage(`🎉 أصاب المقاتل @${id} الإجابة الصحيحة وحصل على نقطة بالمجال! الرصيد الحالي لعقول ديث نوت:\n• فريق @${domain.challenger}: ${domain.challengerScore}\n• فريق @${domain.opponent}: ${domain.opponentScore}`);
        
        domain.questionIndex++;
        setTimeout(nextJointIntellectQuestion, 3000);
        return true;
    }
    return false;
}

async function endJointIntellectDomain() {
    if (!activeJointIntelligenceDomain) return;
    const domain = activeJointIntelligenceDomain;

    let msg = `🏆 *انتهت جولة الذكاء والعباقرة لديث نوت المشترك!* النتيجة النهائية لعقول الساحة:\n`;
    msg += `• فريق @${domain.challenger} (لايت المساعد): ${domain.challengerScore} نقاط ذكية.\n`;
    msg += `• فريق @${domain.opponent} (ريوزاكي L المساعد): ${domain.opponentScore} نقاط ذكية.\n\n`;

    if (domain.challengerScore > domain.opponentScore) {
        await dbHelpers.addPoints(domain.challenger, 15);
        const oUser = await dbHelpers.getUser(domain.opponent, false);
        if (oUser) {
            await dbHelpers.updateUser(domain.opponent, { points: Math.max(0, oUser.points - 15) });
            await dbHelpers.syncPlayerUI(domain.opponent);
        }

        msg += `🥇 انتصر الفارس العبقري @${domain.challenger} وشريكه ياغامي لايت بنفوذ عقلي وحصل على +15 نقطة! وتم خصم 15 نقطة من محفظة الخاسر @${domain.opponent}!`;
    } else if (domain.opponentScore > domain.challengerScore) {
        await dbHelpers.addPoints(domain.opponent, 15);
        const cUser = await dbHelpers.getUser(domain.challenger, false);

        if (activeBuggyShields.has(domain.challenger)) {
            activeBuggyShields.delete(domain.challenger);
            msg += `🛡️ *درع المهرج باجي تصدى للخصم!* تم حماية نقاط الخسران @${domain.challenger} من السحب الإجباري!\n`;
        } else {
            if (cUser) {
                await dbHelpers.updateUser(domain.challenger, { points: Math.max(0, cUser.points - 15) });
                await dbHelpers.syncPlayerUI(domain.challenger);
            }
            msg += `🏆 انتصر العبقري @${domain.opponent} ومساعده ريوزاكي L وسرق 15 نقطة من محفظة الخاسر @${domain.challenger}!`;
        }
    } else {
        msg += `🤝 تعادل تاريخي مطلق لأذكى العقول في ديث نوت! لم يخصم ولم يضاف أي شيء.`;
    }

    dbHelpers.broadcastSystemMessage(msg);
    activeJointIntelligenceDomain = null;
    io.emit('statsUpdate');
}

// ========== دوال الاعتراض التكتيكي لمهارات الشركاء بالأوامر والشات ==========
async function checkAndApplyPartnerTraps(username, text) {
    const id = username.toLowerCase().trim().replace(/^@/, '');

    // 1. اعتراض تجميد الشات لباجي
    if (chatFrozen && id !== chatFrozenUser && !['أيهم', 'أدمن', 'مشرف'].includes(id)) {
        return { block: true, reason: '⏳ الشات مجمد زمنياً حالياً بسبب مهارة باجي النشطة لـ @' + chatFrozenUser };
    }

    // 2. اعتراض فخ "التبديل والاختفاء" لباجي (Skill 1)
    for (const [ownerId, trap] of Object.entries(activeBuggyTraps)) {
        if (trap.type === 'scramble' && ownerId !== id) {
            delete activeBuggyTraps[ownerId];
            dbHelpers.broadcastSystemMessage(`🃏 *خدعة باجي التبديل والاختفاء!* اعترض باجي التابع لـ @${ownerId} إجابة @${id}! وتم حذف إجابته واستبدالها بإجابة خاطئة!`);
            return { block: true, forceWrong: true };
        }
    }

    // 3. اعتراض فخ "سرقة الجائزة" لباجي (Skill 3)
    for (const [ownerId, trap] of Object.entries(activeBuggyTraps)) {
        if (trap.type === 'steal' && ownerId !== id) {
            delete activeBuggyTraps[ownerId];
            return { block: false, stealTo: ownerId }; // تمرير إشارة لسرقة المكافأة للمالك
        }
    }

    // 4. اعتراض فخ "تضليل الكلمات" لدكتور ستون (Skill 2)
    for (const [ownerId, active] of Object.entries(activeDrStoneTraps)) {
        if (active && ownerId !== id) {
            delete activeDrStoneTraps[ownerId];
            dbHelpers.broadcastSystemMessage(`🧬 *تضليل كلمات دكتور ستون!* اعترض سينكو الخاص بـ @${ownerId} إجابة @${id} وصنع لها تضليلاً علمياً خربط الأحرف كلياً فتعتبر غلط!`);
            return { block: true, forceWrong: true };
        }
    }

    // 5. اعتراض فخ "الفراغ اللانهائي" لغوجو ساتورو
    for (const [ownerId, active] of Object.entries(activeGojoTraps)) {
        if (active && ownerId !== id) {
            delete activeGojoTraps[ownerId];
            dbHelpers.broadcastSystemMessage(`🌌 *الفراغ اللانهائي لغوجو شلّ الخصم!* تشتت تركيز @${id} بالمعلومات الفراغية اللانهائية وتم إبطال إجابته تماماً!`);
            return { block: true, forceWrong: true };
        }
    }

    return { block: false };
}

// دالة مساعدة لخلط المصفوفات للحصول على عشوائية مطلقة للأسئلة
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// تصدير دوال محرك الأنمي للاستيراد بـ server.js
module.exports = {
    initPartners,
    handlePartnerCommand,
    checkAndApplyPartnerTraps,
    handleDrStoneAnswer,
    handleJointIntellectAnswer,
    activeDrStoneDomain: () => activeDrStoneDomain,
    activeJointIntelligenceDomain: () => activeJointIntelligenceDomain,
    launchJointIntelligenceDomain,
    normalizeArabic, // تصدير الدالة لاستخدامها في الخادم الرئيسي
    activeBuggyShields,
    activeBuggyTraps,
    activeDrStoneTraps,
    activeGojoTraps
};
