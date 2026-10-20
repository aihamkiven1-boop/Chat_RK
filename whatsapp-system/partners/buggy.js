// partners/buggy.js - مهارات وبطاقات وترقيات وحالة المهرج باجي المخادع مستقلة كلياً
const activeBuggyShields = new Set(); // حماية نقاط باجي
const activeBuggyTraps = {}; // فخاخ باجي النشطة (scramble, steal)

async function handleBuggyCommand(username, args, dbHelpers, chatFrozen, chatFrozenUser) {
    const id = username.toLowerCase().trim().replace(/^@/, '');
    const user = await dbHelpers.getUser(id, false);

    if (!user) return null;

    const skillNum = parseInt(args[0]);
    if (isNaN(skillNum) || skillNum < 1 || skillNum > 4) {
        dbHelpers.sendPrivateNotification(id, "⚠️ التنسيق المطلوب: !باجي [رقم المهارة من 1 إلى 4]");
        return null;
    }

    // مهارة 1: التبديل والاختفاء (سعرها 10 نقاط)
    if (skillNum === 1) {
        if (user.points < 10) {
            dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (10 نقاط).");
            return null;
        }
        
        await dbHelpers.updateUser(id, { points: user.points - 10 });
        if (!user.partners.buggy) user.partners.buggy = {};
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
        if (!user.partners.buggy || !user.partners.buggy.skill2_unlocked) {
            dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. يجب استخدام المهارة الأولى 3 مرات للترقية.");
            return null;
        }
        if (user.points < 15) {
            dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (15 نقطة).");
            return null;
        }
        if (chatFrozen) {
            dbHelpers.sendPrivateNotification(id, "⚠️ الشات متجمد بالفعل حالياً.");
            return null;
        }

        await dbHelpers.updateUser(id, { points: user.points - 15 });
        user.partners.buggy.skill2_uses = (user.partners.buggy.skill2_uses || 0) + 1;

        if (user.partners.buggy.skill2_uses >= 3 && !user.partners.buggy.skill3_unlocked) {
            user.partners.buggy.skill3_unlocked = true;
            dbHelpers.broadcastSystemMessage(`🔓 أسطوري! نجح المقاتل @${id} في ترقية باجي وفتح المهارة الثالثة (سرقة المكافآت)!`);
        }

        await dbHelpers.updateUser(id, { partners: user.partners });
        await dbHelpers.syncPlayerUI(id);

        // إرجاع إشارة للنظام لتفعيل التجميد الزمني بملف partners.js
        return { action: 'freezeChat' };
    }

    // مهارة 3: سرقة المكافأة المباشرة (سعرها 20 نقطة)
    else if (skillNum === 3) {
        if (!user.partners.buggy || !user.partners.buggy.skill3_unlocked) {
            dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. استخدم المهارة الثانية لترقيتها.");
            return null;
        }
        if (user.points < 20) {
            dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (20 نقطة).");
            return null;
        }

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
        if (!user.partners.buggy || !user.partners.buggy.skill4_unlocked) {
            dbHelpers.sendPrivateNotification(id, "🔒 هذه المهارة مغلقة. استخدم المهارة الثالثة لترقيتها.");
            return null;
        }
        if (user.points < 10) {
            dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم المهارة (10 نقاط).");
            return null;
        }

        await dbHelpers.updateUser(id, { points: user.points - 10 });
        await dbHelpers.syncPlayerUI(id);

        activeBuggyShields.add(id);
        dbHelpers.broadcastSystemMessage(`🛡️ قام @${id} بتركيب "درع حماية النقاط" لباجي! لن يخسر أي نقاط إذا خسر في النزالات القادمة!`);
    }

    return null;
}

module.exports = {
    activeBuggyShields,
    activeBuggyTraps,
    handleBuggyCommand
};
