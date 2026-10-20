// domains/deathnoteDomain.js - إدارة نزال وتشغيل مجال ديث نوت المشترك مستقل كلياً
const { INTELLECT_QUESTIONS } = require('../questions/intellect');
const { shuffleArray } = require('../utils/shuffle');
const { normalizeArabic } = require('../utils/normalizeArabic');
const buggy = require('../partners/buggy');

let activeJointIntelligenceDomain = null; // حالة المجال الذكي النشط
let io = null;
let dbHelpers = {};

function initDeathNote(socketIoInstance, helpers) {
    io = socketIoInstance;
    dbHelpers = helpers;
}

function launchJointIntelligenceDomain(challenger, opponent) {
    activeJointIntelligenceDomain = {
        challenger: challenger,
        opponent: opponent,
        challengerScore: 0,
        opponentScore: 0,
        questionIndex: 0,
        questions: shuffleArray([...INTELLECT_QUESTIONS]).slice(0, 8),
        timer: null,
        answeringLocked: false // حماية من الازدواجية والتسجيل المزدوج
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

    const isChallengerTurn = domain.questionIndex % 2 === 0; // تناوب الأدوار التلقائي للمساعدين
    
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

        if (cUser) {
            // التحقق من تفعيل درع باجي لحماية نقاط المالك من الأخذ (مستورد من موديول باجي)
            if (buggy.activeBuggyShields.has(domain.challenger)) {
                buggy.activeBuggyShields.delete(domain.challenger);
                msg += `🛡️ *درع المهرج باجي تصدى للخصم!* تم حماية نقاط الخسران @${domain.challenger} من السحب الإجباري!\n`;
            } else {
                await dbHelpers.updateUser(domain.challenger, { points: Math.max(0, cUser.points - 15) });
                await dbHelpers.syncPlayerUI(domain.challenger);
                msg += `🏆 انتصر العبقري @${domain.opponent} ومساعده ريوزاكي L وسرق 15 نقطة من محفظة الخاسر @${domain.challenger}!`;
            }
        }
    } else {
        msg += `🤝 تعادل تاريخي مطلق لأذكى العقول في ديث نوت! لم يخصم ولم يضاف أي شيء.`;
    }

    dbHelpers.broadcastSystemMessage(msg);
    activeJointIntelligenceDomain = null;
    io.emit('statsUpdate');
}

module.exports = {
    activeJointIntelligenceDomain: () => activeJointIntelligenceDomain,
    initDeathNote,
    launchJointIntelligenceDomain,
    handleJointIntellectAnswer
};
