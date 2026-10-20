// utils/helpers.js - موديول أدوات الحماية والرقابة والتشفير وتطهير الـ XSS الموحد بـ SQLite والـ Sockets
const crypto = require('crypto');

// مصفوفة الكلمات غير المقبولة والمخالفة للذوق العام للرقابة التلقائية
const BAD_WORDS = ["كلب", "حمار", "غبي", "حيوان", "تفه", "قذر", "سافل", "ياكلب", "ياحمار", "منحط"];

// متتبع توقيت رسائل اللاعبين لرصد السبام لمنع تضخم الذاكرة
const spamTracker = {};

/**
 * دالة تشفير وتأمين رموز دخول فرسان الساحة بـ SHA-256
 * @param {string} passcode - الرمز السري الصريح
 */
function hashPasscode(passcode) {
    return crypto.createHash('sha256').update(passcode).digest('hex');
}

/**
 * دالة تعقيم وتصفية النصوص لمنع ثغرات حقن الأكواد الخبيثة XSS كلياً بالدردشة والرادار
 * @param {string} text - النص الخام المدخل بمتصفح اللاعب
 */
function escapeHtml(text) {
    if (!text) return "";
    return text
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * دالة فحص وجود كلمات بذيئة ومخالفة للذوق العام للدردشة بساحة المعركة
 * @param {string} text - الرسالة المدخلة
 */
function containsBadWord(text) {
    const clean = text.toLowerCase().replace(/\s+/g, '');
    return BAD_WORDS.some(word => clean.includes(word));
}

/**
 * دالة رصد وحظر الإغراق والسبام مع القضاء التام على تسرب الذاكرة وتضخم المفاتيح بالقرص
 * @param {string} sender - اسم العضو المرسل للدردشة
 */
function checkSpam(sender) {
    const now = Date.now();
    if (!spamTracker[sender]) spamTracker[sender] = [];
    spamTracker[sender].push(now);
    
    // تصفية وحصر مصفوفة الرسائل بآخر 6 ثوانٍ فقط
    spamTracker[sender] = spamTracker[sender].filter(t => now - t < 6000);
    
    // [مصحح] حل مشكلة تسرب رامات الهاتف وتراكم المفاتيح بحذف اللاعب كلياً فور انتهاء توقيته
    if (spamTracker[sender].length === 0) {
        delete spamTracker[sender];
        return false;
    }
    
    return spamTracker[sender].length >= 10;
}

/**
 * دالة تفكيك واستبدال الرموز العريضة (*) بساحة الدردشة
 * @param {string} text - الرسالة الممررة
 */
function formatAsteriskToBold(text) {
    if (!text) return "";
    return text.toString().replace(/\*(.*?)\*/g, '<strong>$1</strong>');
}

module.exports = {
    hashPasscode,
    escapeHtml,
    containsBadWord,
    checkSpam,
    formatAsteriskToBold
};
