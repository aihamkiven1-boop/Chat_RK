// partners/gojo.js - مهارات وحالة ساتورو غوجو مستقلة كلياً
const activeGojoTraps = {}; // فخاخ غوجو النشطة (الفراغ اللانهائي)

async function handleGojoCommand(username, dbHelpers) {
    const id = username.toLowerCase().trim().replace(/^@/, '');
    const user = await dbHelpers.getUser(id, false);

    if (!user) return;

    if (user.points < 10) {
        dbHelpers.sendPrivateNotification(id, "⚠️ رصيدك أقل من رسوم تفعيل المجال (10 نقاط).");
        return;
    }

    await dbHelpers.updateUser(id, { points: user.points - 10 });
    await dbHelpers.syncPlayerUI(id);

    activeGojoTraps[id] = true;
    dbHelpers.broadcastSystemMessage(`🌌 *توسيع المجال: الفراغ اللانهائي لغوجو!* قام @${id} بنشر المعلومات اللانهائية لشل عقل الإجابة القادمة للخصوم!`);
}

module.exports = {
    activeGojoTraps,
    handleGojoCommand
};
