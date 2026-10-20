// partners/light.js - مهارات وحالة وحقن ملكية ياغامي لايت مستقلة كلياً
function verifyLightOwner(user) {
    return !!(user && user.partners && user.partners.light && user.partners.light.owned);
}

module.exports = { verifyLightOwner };
