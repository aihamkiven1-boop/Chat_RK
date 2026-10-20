// partners/l.js - مهارات وحالة وحقن ملكية ريوزاكي L مستقلة كلياً
function verifyLOwner(user) {
    return !!(user && user.partners && user.partners.l && user.partners.l.owned);
}

module.exports = { verifyLOwner };
