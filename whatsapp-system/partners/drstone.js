// partners/drstone.js - مهارات ونزالات ومجال دكتور ستون سينكو العلمي مستقل كلياً
const { SCIENCE_QUESTIONS } = require('../questions/science');
const { shuffleArray } = require('../utils/shuffle');
const { normalizeArabic } = require('../utils/normalizeArabic');
const buggy = require('./buggy');

const activeDrStoneTraps = {}; // فخاخ دكتور ستون النشطة (word scramble)
let activeDrStoneDomain = null; // حالة المجال العلمي النشط
let io = null;
let dbHelpers = {};

function initDrStone(socketIoInstance, helpers) {
    io = socketIoInstance;
    dbHelpers = helpers;
}

async function handleDrStoneCommand(username, args, chatFrozen, chatFrozenUser) {
    const id = username.toLowerCase().trim().replace(/^@/, '');
    const user = await dbHelpers.getUser(id, false);

    if (!user) return;

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
        if (!opponentObj) {
            dbHelpers.sendPrivateNotification(id, `⚠️ اللاعب المستهدف [ ${opponentName} ] غير متصل أو غير مسجل.`);
            return;
        }
        if (opponentObj.points < 10) return dbHelpers.sendPrivateNotification(id, "🚫 الخصم لا يملك 10 نقاط كحد أدنى لدخول المجال.");

        await dbHelpers.updateUser(id, { points: user.points - 15 });
        if (!user.partners.drstone) user.partners.drstone = {};
        user.partners.drstone.skill1_uses = (user.partners.drstone.skill1_uses || 0) + 1;

        if (user.partners.drstone.skill1_uses >= 3 && !user.partners.drstone.skill2_unlocked) {
            user.partners.drstone.skill2_unlocked = true;
            dbHelpers.broadcastSystemMessage(`🔓 أسطوري! نجح @${id} في ترقية دكتور ستون وفتح المهارة الثانية (تضليل الكلمات)!`);
        }

        await dbHelpers.updateUser(id, { partners: user.partners });
        await dbHelpers.syncPlayerUI(id);

        // إطلاق نزال المجال العلمي لـ دكتور ستون
        launchDrStoneScienceDomain(id, opponentObj.id);
    }

    // مهارة 2: تضليل الكلمات وخربطة الإجابة الصحيحة (السعر 5 نقاط)
    else if (skillNum === 2) {
        if (!user.partners.drstone || !user.partners.drstone.skill2_unlocked) {
            return dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. استخدم المهارة الأولى 3 مرات لترقيتها.");
        }
        if (user.points < 5) {
            return dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (5 نقاط).");
        }

        await dbHelpers.updateUser(id, { points: user.points - 5 });
        await dbHelpers.syncPlayerUI(id);

        activeDrStoneTraps[id] = true;
        dbHelpers.broadcastSystemMessage(`🧬 @${id} استدعى دكتور ستون! وتم تفعيل فخ "تضليل الكلمات وخربطة الإجابة القادمة" بنجاح!`);
    }
}

function launchDrStoneScienceDomain(challenger, opponent) {
    activeDrStoneDomain = {
        challenger: challenger,
        opponent: opponent,
        challengerScore: 0,
        opponentScore: 0,
        questionIndex: 0,
        questions: shuffleArray([...SCIENCE_QUESTIONS]).slice(0, 10),
        timer: null,
        answeringLocked: false
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

    domain.answeringLocked = false;
    const currentQ = domain.questions[domain.questionIndex];
    dbHelpers.broadcastSystemMessage(`🧪 *المجال العلمي (السؤال ${domain.questionIndex + 1}/10):*\n❓ السؤال: *${currentQ.q}*\n⏱️ مهلة الإجابة السريعة: 15 ثانية!`);

    domain.timer = setTimeout(() => {
        domain.answeringLocked = true;
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
    if (domain.answeringLocked) return false;

    const currentQ = domain.questions[domain.questionIndex];
    if (normalizeArabic(text) === normalizeArabic(currentQ.a)) {
        domain.answeringLocked = true;
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
        
        if (cUser) {
            // التحقق من تفعيل درع باجي لحماية نقاط المالك من الأخذ (مستورد من الموديول الجديد لباجي)
            if (buggy.activeBuggyShields.has(domain.challenger)) {
                buggy.activeBuggyShields.delete(domain.challenger);
                msg += `🛡️ *درع المهرج باجي تصدى للخصم!* تم حماية نقاط الخسران @${domain.challenger} من السرقة!\n`;
            } else {
                await dbHelpers.updateUser(domain.challenger, { points: Math.max(0, cUser.points - 10) });
                await dbHelpers.syncPlayerUI(domain.challenger);
                msg += `🏆 انتصر الخصم @${domain.opponent} وسرق 10 نقاط من محفظة الخاسر @${domain.challenger}!`;
            }
        }
    } else {
        msg += `🤝 تعادل عبقري ومميز في المجال! لم يخصم ولم يضاف أي رصيد للطرفين.`;
    }

    dbHelpers.broadcastSystemMessage(msg);
    activeDrStoneDomain = null;
    io.emit('statsUpdate');
}

module.exports = {
    activeDrStoneTraps,
    activeDrStoneDomain: () => activeDrStoneDomain,
    initDrStone,
    handleDrStoneCommand,
    handleDrStoneAnswer
};
