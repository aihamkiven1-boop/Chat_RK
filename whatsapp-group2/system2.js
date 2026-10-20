const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ========== الإعدادات الأساسية للنظام (منفذ المتجر المطور) ==========
const PREFIX = '!';
const TARGET_GROUP = '120363410336508653@g.us'; // آيدي مجموعة المتجر الخاص بك
const OWNER_NUMBER = '967776436212@s.whatsapp.net';
const USERS_DB = 'users_db.json'; // الربط التزامني اللحظي مع الجروب الأول

const sleep = ms => new Promise(res => setTimeout(res, ms));
const sendTyping = async (sock, chatId) => await sock.sendPresenceUpdate('composing', chatId);

if (!fs.existsSync('temp')) fs.mkdirSync('temp');

// ========== المتغيرات العامة للنظام وحمايته ==========
let sock;
let stopBot = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// متغيرات حماية الضغط والرصد
const messageTimestamps = [];
let pressurePaused = false;
let pressureTimer = null;
const PRESSURE_THRESHOLD = 12;
const PRESSURE_WINDOW = 10000;
const PRESSURE_COOLDOWN = 180000;

const PROTECTED_NUMBERS = [
    '967776436212@s.whatsapp.net',
    '967774106772@s.whatsapp.net'
];

// ========== دوال حماية وأمان النظام من السبام والضغط ==========
const spamTracker = {};
function checkSpam(sender) {
    const now = Date.now();
    if (!spamTracker[sender]) spamTracker[sender] = [];
    spamTracker[sender].push(now);
    spamTracker[sender] = spamTracker[sender].filter(t => now - t < 10000); // نافذة 10 ثوانٍ
    return spamTracker[sender].length >= 5; // بحد أقصى 5 رسائل في 10 ثوانٍ
}

function checkPressure() {
    const now = Date.now();
    messageTimestamps.push(now);
    while (messageTimestamps.length && now - messageTimestamps[0] > PRESSURE_WINDOW) {
        messageTimestamps.shift();
    }
    if (messageTimestamps.length >= PRESSURE_THRESHOLD && !pressurePaused) {
        pressurePaused = true;
        if (sock) {
            sock.sendMessage(TARGET_GROUP, { text: '⚠️ *ضغط عالٍ على النظام!*\n🛑 تم إيقاف استقبال الطلبات في المتجر لمدة 3 دقائق لتصحيح الوضع تلقائياً.\n⏳ يرجى الانتظار...' });
        }
        if (pressureTimer) clearTimeout(pressureTimer);
        pressureTimer = setTimeout(() => {
            pressurePaused = false;
            messageTimestamps.length = 0;
            if (sock) {
                sock.sendMessage(TARGET_GROUP, { text: '✅ *عاد النظام للعمل.*\n🔕 يرجى تجنب السبام وإرسال الأوامر المكثفة لضمان استقرار الخدمة.' });
            }
        }, PRESSURE_COOLDOWN);
    }
}

const badWords = ['كلمة1', 'كلمة2'];
function containsBadWord(text) {
    const lowerText = text.toLowerCase();
    return badWords.some(word => lowerText.includes(word.toLowerCase()));
}

// ========== جلب وحفظ قاعدة البيانات التزامنية ==========
const getDB = (filePath) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(filePath));
};
const saveDB = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

// ========== نظام الرتب الفخمة الموحد ==========
const RANKS = [
    { name: '🆕 عابر سبيل', minPoints: 0, bonus: 0 },
    { name: '🛡️ محارب مستجد', minPoints: 100, bonus: 0 },
    { name: '⚔️ كاسر الدروع', minPoints: 300, bonus: 1 },
    { name: '🏅 فارس النخبة', minPoints: 500, bonus: 2 },
    { name: '👑 جنرال المهابة', minPoints: 1000, bonus: 4 },
    { name: '🌌 إمبراطور الكون', minPoints: 2000, bonus: 6 }
];

const getRank = (points) => {
    let rank = RANKS[0];
    for (const r of RANKS) if (points >= r.minPoints) rank = r;
    return rank;
};

// ────────────── جلب وتحديث المستخدم الموحد ──────────────
const getUser = (userId) => {
    const db = getDB(USERS_DB);
    if (!db[userId]) {
        db[userId] = {
            points: 0, warnings: 0, correctAnswers: 0, totalAttempts: 0,
            lastWin: null, birthday: null, dailyGiftClaimed: null,
            challengeWins: 0, debts: [],
            badge: "",             
            has_entrance: false,   
            has_insurance: 0,      
            has_vault: false,      
            vault_time: 0,         
            has_double_xp: false,  
            xp_boost_expiry: 0,    
            has_welcome_sponsor: false, 
            purchased_icon: false, 
            has_stealer_trap: false,
            summon: "" // حقل تخزين ميزانية المستدعى الأسطوري المختار
        };
        saveDB(USERS_DB, db);
    } else {
        let updated = false;
        const defaultFields = {
            badge: "", has_entrance: false, has_insurance: 0, has_vault: false,
            vault_time: 0, has_double_xp: false, xp_boost_expiry: 0,
            has_welcome_sponsor: false, purchased_icon: false, has_stealer_trap: false, debts: [],
            summon: ""
        };
        for (const [key, value] of Object.entries(defaultFields)) {
            if (db[userId][key] === undefined) {
                db[userId][key] = value;
                updated = true;
            }
        }
        if (updated) saveDB(USERS_DB, db);
    }
    return db[userId];
};

const updateUser = (userId, updates) => {
    const db = getDB(USERS_DB);
    if (!db[userId]) {
        db[userId] = {
            points: 0, warnings: 0, correctAnswers: 0, totalAttempts: 0,
            lastWin: null, birthday: null, dailyGiftClaimed: null,
            challengeWins: 0, debts: [],
            badge: "", has_entrance: false, has_insurance: 0, has_vault: false,
            vault_time: 0, has_double_xp: false, xp_boost_expiry: 0,
            has_welcome_sponsor: false, purchased_icon: false, has_stealer_trap: false,
            summon: ""
        };
    }
    Object.assign(db[userId], updates);
    if (db[userId].points < 0) db[userId].points = 0;
    saveDB(USERS_DB, db);
    return db[userId];
};

// ========== معروضات المتجر الإمبراطوري المتزامن مع شخصيات الأنمي ==========
const STORE_ITEMS = {
    // شخصيات المستدعين الأسطوريين
    luffy: { name: "🏴‍☠️ المستدعى الأسطوري: مونكي دي لوفي", price: 400, desc: "تفعيل لوفي كشريك قتالي (يقلل خسارة النقاط 30% كامناً، وتدبيل نقاطك 3x بمهارة !مهارة لوفي النشطة بالجروب الأول)." },
    itachi: { name: "👁️ المستدعى الأسطوري: يوتشيها إيتاشي", price: 450, desc: "تفعيل إيتاشي (يرسل تلميح سري في الخاص بفعالية كلمة السر كامناً، ويعكس رهان خصمك بمهارة !مهارة ايتاشي النشطة)." },
    gojo: { name: "🤞 المستدعى الأسطوري: ساتورو غوجو", price: 500, desc: "تفعيل غوجو (حماية مطلقة من فخاخ السرقة وسلب النقاط كامناً، وتجميد الجروب بالكامل ومنعهم من الحل بمهارة !مهارة غوجو النشطة)." },
    jinwoo: { name: "⚔️ المستدعى الأسطوري: سونغ جين وو", price: 550, desc: "تفعيل جين وو (فرصة 25% لجني +15 نقطة إضافية عند كل إجابة صحيحة كامناً، وإلغاء طردك وتصفير إنذاراتك بمهارة !مهارة جين_وو النشطة)." },
    
    // سلع الامتيازات والأوسمة
    badge: { name: "🏷️ الوسام الشخصي الملحق", price: 150, desc: "شراء لقب/وسام مخصص يظهر بجانب اسمك في كل مكان بالنظام. الاستخدام: !شراء badge [اللقب]" },
    entrance: { name: "👑 ميزة الدخول الملكي", price: 200, desc: "يرسل النظام إعلاناً ترحيبياً فخماً ومزخرفاً فور إرسال أول رسالة لك يومياً بالجروب الأول." },
    rename: { name: "📝 مرسوم تغيير اسم جروب المتجر", price: 400, desc: "يمنحك الحق في تغيير اسم جروب المتجر بالكامل لمدة 24 ساعة. الاستخدام: !شراء rename [الاسم الجديد]" },
    icon: { name: "🖼️ أيقونة الجروب المخصصة للمتجر", price: 350, desc: "يسمح لك بتغيير الصورة الرمزية لجروب المتجر بالرد على أي صورة تعجبك بـ !تطبيق_الأيقونة." },
    welcome: { name: "👋 بطاقة الترحيب المخصصة للجروب الأول", price: 180, desc: "يكتب النظام اسمك كراعٍ رسمي ومهيب للجروب في كل رسالة ترحيب بالعضاء الجدد بالجروب الأول لمدة 3 أيام." },
    insurance: { name: "🛡️ وثيقة تأمين التحديات للجروب الأول", price: 120, desc: "تحميك من خسارة النقاط في 3 تحديات متتالية بالجروب الأول (يعوض النظام الخصم بدلاً منك)." },
    vault: { name: "🔑 الخزنة المؤمنة لمدة 48 ساعة", price: 80, desc: "تحمي حسابك بالكامل من أي طلبات تحديات أو رهانات إجبارية في الجروب الأول." },
    warning_remover: { name: "🧼 مسح السجل والإنذارات الإدارية", price: 80, desc: "يقوم بحذف إنذار إداري واحد من حسابك في قاعدة البيانات الموحدة." },
    mana_booster: { name: "🧪 إكسير المانا المضاعف للجروب الأول", price: 120, desc: "يضاعف جميع النقاط التي تكتسبها من فعاليات الجروب الأول لمدة ساعتين كاملتين." },
    stealer_trap: { name: "🕸️ فخ سرقة النقاط للرهانات", price: 150, desc: "فخ ذكي في الجروب الأول؛ أول من يتجرأ على رهانك أو طلب تحديك يسرق منه فخك 25 نقطة تلقائياً." }
};

// أدلة الاستدعاء الحصرية المرسلة تلقائياً عند الشراء
const SUMMON_GUIDES = {
    luffy: `🏴‍☠️ *سند الاستدعاء الأسطوري: مونكي دي لوفي* 🏴‍☠️\n━━━━━━━━━━━━━━━━━━━━━━━━━\nتهانينا! لقد قمت باستدعاء شمس الحرية "لوفي" ليكون شريكك القتالي المعتمد!\n\n📖 *دليل القدرات المتاحة لك الآن في الجروب الأول:*\n\n✨ *1. القدرة الكامنة تلقائياً (المطاط):*\n   حسابك محمي الآن بنسبة 30% من أي خسارة نقاط عند الإجابة الخاطئة أو الرهانات بالجروب الأول!\n\n🔥 *2. المهارة النشطة (المحرك الخامس - الجير فايف 🌟):*\n   • *الأمر القتالي:* اكتب بالجروب الأول: *!مهارة لوفي*\n   • *التأثير قريباً:* تضاعف نقاط أول سؤال تجيب عليه بشكل صحيح بثلاثة أضعاف (3x)!\n   • *الانتظار (Cooldown):* يمكنك استخدام هذه القوة المدمرة مرة واحدة كل 12 ساعة.\n━━━━━━━━━━━━━━━━━━━━━━━━━`,
    itachi: `👁️ *سند الاستدعاء الأسطوري: يوتشيها إيتاشي* 👁️\n━━━━━━━━━━━━━━━━━━━━━━━━━\nلقد اخترقت عهد الظلال واستدعيت عبقري الأوهام "إيتاشي" ليكون حليفك النينجا!\n\n📖 *دليل القدرات المتاحة لك الآن في الجروب الأول:*\n\n✨ *1. القدرة الكامنة تلقائياً (شارينغان الملاحظة):*\n   تكشف لك تلميحاً إضافياً سرياً للغاية في فعاليات "كلمة السر" يرسل تلقائياً لرسائل الخاص لديك ليساعدك على الفوز قبل الجميع!\n\n🔥 *2. المهارة النشطة (التسوكيومي اللانهائية 🌀):*\n   • *الأمر القتالي:* اكتب بالجروب الأول: *!مهارة ايتاشي @منشن* (استهدف خصمك)\n   • *التأثير قريباً:* إذا تحداك الشخص المستهدف وخسرت النزال، تنعكس النتيجة فوراً وتذهب النقاط العشر كاملة إليك كخداع بصري!\n   • *الانتظار (Cooldown):* يمكنك استخدامها مرة واحدة كل 24 ساعة.\n━━━━━━━━━━━━━━━━━━━━━━━━━`,
    gojo: `🤞 *سند الاستدعاء الأسطوري: ساتورو غوجو* 🤞\n━━━━━━━━━━━━━━━━━━━━━━━━━\nلقد أيقظت الأقوى واستدعيت ممتلك اللانهاية "ساتورو غوجو" لحمايتك الكونية!\n\n📖 *دليل القدرات المتاحة لك الآن في الجروب الأول:*\n\n✨ *1. القدرة الكامنة تلقائياً (حظر اللانهاية المطلق):*\n   حسابك محمي ومحصن تلقائياً ومطلقاً ضد فخاخ سرقة النقاط، وأي محاولات سلب أو مهارات سلبية يطلقها الأعضاء الآخرون ضدك.\n\n🔥 *2. المهارة النشطة (توسيع المجال - الفراغ اللانهائي 🌌):*\n   • *الأمر القتالي:* اكتب بالجروب الأول: *!مهارة غوجو*\n   • *التأثير قريباً:* تجميد الجروب الأول برمجياً لمدة دقيقتين كاملتين بحيث لا يستطيع أي عضو آخر الإجابة على أسئلة الفعاليات النشطة غيرك أنت فقط!\n   • *الانتظار (Cooldown):* يمكنك إطلاق هذا المجال المدمر مرة واحدة كل 24 ساعة.\n━━━━━━━━━━━━━━━━━━━━━━━━━`,
    jinwoo: `⚔️ *سند الاستدعاء الأسطوري: سونغ جين وو* ⚔️\n━━━━━━━━━━━━━━━━━━━━━━━━━\nلقد نطقت بالكلمة المقدسة "النهوض" واستدعيت ملك الظلال وسيد الموتى "سونغ جين وو"!\n\n📖 *دليل القدرات المتاحة لك الآن في الجروب الأول:*\n\n✨ *1. القدرة الكامنة تلقائياً (استخراج الظلال):*\n   عند إجابتك على أي سؤال صحيح بالجروب الأول، هناك فرصة 25% لاستخراج ظل يمنحك +15 نقطة إضافية كهدية مانا فورا!\n\n🔥 *2. المهارة النشطة (مستدعى الظل - بيل الملتهم 💀):*\n   • *الأمر القتالي:* اكتب بالجروب الأول: *!مهارة جين_وو*\n   • *التأثير قريباً:* إذا تراكمت عليك 3 إنذارات وكان النظام على وشك طردك تلقائياً، تطلق المهارة ليلغي ملك الظلال طردك ويمسح إنذاراتك بالكامل لتستمر بالجروب!\n   • *تنبيه هائم:* تستخدم المهارة لمرة واحدة فقط وتختفي الشخصية وتتطلب إعادة الشراء.\n━━━━━━━━━━━━━━━━━━━━━━━━━`
};

async function showStats(sock, chatId, senderId) {
    const user = getUser(senderId);
    const rank = getRank(user.points);
    
    await sock.sendMessage(chatId, { 
        text: `📊 *ملف رصيدك ومشترياتك الموحد (بوابة المتجر)*\n\n🏷 الرتبة الحالية: ${rank.name}\n🎖 الوسام الحالي: ${user.badge || 'لم يتم الشراء بعد ❌'}\n🔮 شريكك القتالي النشط: ${user.summon ? STORE_ITEMS[user.summon]?.name || 'غير متوفر' : 'بلا شريك حالياً ❌'}\n🪙 رصيدك المكتسب (من الجروب الأول): ${user.points} نقطة\n🛡️ وثائق التأمين المتبقية: ${user.has_insurance}\n🔑 حماية الخزنة النشطة: ${user.has_vault ? 'مفعلة ✅' : 'غير مفعلة ❌'}\n🧪 مضاعف المانا الفعال: ${user.has_double_xp ? 'نشط ومضاعف ✅' : 'غير نشط ❌'}`,
        mentions: [senderId]
    });
}

// ========== معالجة الأوامر المالية والشرائية في المتجر ==========
async function handleCommand(sock, msg, command, args) {
    const chatId = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;

    const typos = {
        'هديه': 'هدية', 'نقاطى': 'نقاطي', 'احصائياتى': 'احصائياتي', 'حقيبتي': 'حقيبتي', 'المتجر': 'متجر'
    };
    if (typos[command]) command = typos[command];

    await sendTyping(sock, chatId);
    await sleep(400);

    try {
        const user = getUser(senderId);

        switch(command) {
            case 'نقاطي':
                await sock.sendMessage(chatId, { text: `🪙 رصيدك الحالي الموحد والمزامن هو: *${user.points}* نقطة.\n🏷 رتبتك في النظام: *${getRank(user.points).name}*` });
                break;

            case 'احصائياتي':
                await showStats(sock, chatId, senderId);
                break;

            case 'متجر': {
                let storeMsg = `👑 *بوابة المتجر الإمبراطوري الموحد (شراء وتفعيل)* 👑\n`;
                storeMsg += `💡 رصيدك مأخوذ تلقائياً من الجروب الأول، اشترِ هنا لتفعل هناك!\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
                for (const [key, item] of Object.entries(STORE_ITEMS)) {
                    storeMsg += `🔑 *الرمز:* !شراء ${key}\n`;
                    storeMsg += `🛡️ *السلعة:* ${item.name}\n`;
                    storeMsg += `💰 *السعر:* ${item.price} نقطة\n`;
                    storeMsg += `📝 *الوصف:* ${item.desc}\n\n`;
                }
                storeMsg += `━━━━━━━━━━━━━━━━━━━━━\n💼 لمعاينة حقيبتك وميزاتك النشطة: !حقيبتي`;
                await sock.sendMessage(chatId, { text: storeMsg });
                break;
            }

            case 'شراء': {
                const itemKey = args[0];
                if (!itemKey || !STORE_ITEMS[itemKey]) {
                    return sock.sendMessage(chatId, { text: '⚠️ رمز السلعة غير معروف بالمتجر. أرسل !متجر لاستعراض الرموز والسلع المتاحة.' });
                }
                const item = STORE_ITEMS[itemKey];
                if (user.points < item.price) {
                    return sock.sendMessage(chatId, { text: `⚠️ رصيدك المكتسب غير كافٍ لشراء ${item.name}. السعر: ${item.price} نقطة (رصيدك الحالي: ${user.points} نقطة).` });
                }

                // تنفيذ عمليات شراء الشخصيات الأسطورية (لوفي، إيتاشي، غوجو، جين وو)
                if (['luffy', 'itachi', 'gojo', 'jinwoo'].includes(itemKey)) {
                    if (user.summon === itemKey) {
                        return sock.sendMessage(chatId, { text: `⚠️ أنت تمتلك الشريك القتالي ${item.name} بالفعل بنشاط في حسابك.` });
                    }
                    updateUser(senderId, { points: user.points - item.price, summon: itemKey });
                    const guideMessage = SUMMON_GUIDES[itemKey];
                    await sock.sendMessage(chatId, { text: `🎉 *تمت المعاملة واستدعاء الشريك القاري بنجاح!*\nخصم ${item.price} نقطة من رصيدك الموحد.\n\n${guideMessage}` });
                }
                // تنفيذ عمليات السلع والامتيازات الأخرى
                else if (itemKey === 'badge') {
                    const badgeText = args.slice(1).join(' ').trim();
                    if (!badgeText) return sock.sendMessage(chatId, { text: '⚠️ يرجى كتابة اللقب/الوسام بعد الرمز. مثال: !شراء badge [اللقب]' });
                    if (badgeText.length > 25) return sock.sendMessage(chatId, { text: '⚠️ طول اللقب مبالغ فيه؛ الحد الأقصى 25 حرفاً.' });
                    updateUser(senderId, { points: user.points - item.price, badge: badgeText });
                    await sock.sendMessage(chatId, { text: `✅ تم شراء وتفعيل الوسام الشخصي بنجاح: [ *${badgeText}* ]\n✨ سيظهر هذا الوسام بجانب اسمك في جميع إحصائيات ولوحة شرف الجروب الأول تلقائياً!` });
                } 
                else if (itemKey === 'entrance') {
                    if (user.has_entrance) return sock.sendMessage(chatId, { text: '⚠️ ميزة الدخول الملكي نشطة ومفعلة في حسابك مسبقاً.' });
                    updateUser(senderId, { points: user.points - item.price, has_entrance: true });
                    await sock.sendMessage(chatId, { text: '✅ تم شراء ميزة الدخول الملكي بنجاح!\n👑 سيقوم النظام بإعلان حضورك الفخم في الجروب الأول يومياً عند كتابتك لأول رسالة هناك.' });
                }
                else if (itemKey === 'rename') {
                    const groupNewName = args.slice(1).join(' ').trim();
                    if (!groupNewName) return sock.sendMessage(chatId, { text: '⚠️ يرجى تحديد الاسم الجديد لجروب المتجر بعد الأمر. مثال: !شراء rename [الاسم]' });
                    try {
                        updateUser(senderId, { points: user.points - item.price });
                        await sock.groupUpdateSubject(chatId, groupNewName);
                        await sock.sendMessage(chatId, { text: `📝 تم تطبيق مرسوم تغيير اسم جروب المتجر بنجاح لـ: [ *${groupNewName}* ]` });
                    } catch(e) {
                        return sock.sendMessage(chatId, { text: '❌ تعذر تعديل الاسم بسبب قيود الصلاحيات للنظام.' });
                    }
                }
                else if (itemKey === 'icon') {
                    updateUser(senderId, { points: user.points - item.price, purchased_icon: true });
                    await sock.sendMessage(chatId, { text: '✅ تم شراء تصريح تعديل أيقونة الجروب المخصصة للمتجر!\n🖼️ قم بالرد بالأمر التالي على أي صورة بالجروب لتطبيقها: *!تطبيق_الأيقونة*' });
                }
                else if (itemKey === 'welcome') {
                    if (user.has_welcome_sponsor) return sock.sendMessage(chatId, { text: '⚠️ ميزة رعاية الترحيب مفعلة ونشطة لديك بالفعل.' });
                    updateUser(senderId, { points: user.points - item.price, has_welcome_sponsor: true });
                    await sock.sendMessage(chatId, { text: '✅ تم شراء رعاية بطاقة الترحيب بنجاح! سيتم إدراج اسمك كراعٍ رسمي ومهيب في ترحيب الأعضاء الجدد بالجروب الأول.' });
                }
                else if (itemKey === 'insurance') {
                    const currentInsurance = user.has_insurance || 0;
                    updateUser(senderId, { points: user.points - item.price, has_insurance: currentInsurance + 3 });
                    await sock.sendMessage(chatId, { text: `✅ تم شراء 3 وثائق تأمين بنجاح! رصيدك بالجروب الأول محمي الآن من الخصم عند خسارة أول 3 تحديات.` });
                }
                else if (itemKey === 'vault') {
                    if (user.has_vault) return sock.sendMessage(chatId, { text: '⚠️ الخزنة المؤمنة مفعلة ونشطة في حسابك مسبقاً.' });
                    const expiry = Date.now() + (48 * 60 * 60 * 1000);
                    updateUser(senderId, { points: user.points - item.price, has_vault: true, vault_time: expiry });
                    await sock.sendMessage(chatId, { text: '🔒 تم شراء وتفعيل الخزنة المؤمنة بنجاح! تم حظر تحديات ورهانات الأعضاء الآخرين ضدك بالجروب الأول لمدة 48 ساعة.' });
                }
                else if (itemKey === 'warning_remover') {
                    if (user.warnings <= 0) return sock.sendMessage(chatId, { text: '⚠️ حسابك الموحد خالٍ تماماً من الإنذارات الإدارية لمسحها.' });
                    updateUser(senderId, { points: user.points - item.price, warnings: user.warnings - 1 });
                    await sock.sendMessage(chatId, { text: `🧼 تم مسح إنذار واحد من حسابك الموحد بنجاح! سجل إنذاراتك الحالي: ${user.warnings - 1}/3` });
                }
                else if (itemKey === 'mana_booster') {
                    if (user.has_double_xp) return sock.sendMessage(chatId, { text: '⚠️ إكسير المانا المضاعف نشط وفعال في حسابك حالياً.' });
                    const expiry = Date.now() + (2 * 60 * 60 * 1000);
                    updateUser(senderId, { points: user.points - item.price, has_double_xp: true, xp_boost_expiry: expiry });
                    await sock.sendMessage(chatId, { text: '🧪 تم تفعيل إكسير المانا بنجاح! جميع جوائز نقاط فعاليات وتحديات الجروب الأول ستكون مضاعفة (x2) لمدة ساعتين متواصلتين.' });
                }
                else if (itemKey === 'stealer_trap') {
                    if (user.has_stealer_trap) return sock.sendMessage(chatId, { text: '⚠️ فخ سرقة النقاط نشط ومنصوب في حسابك بالفعل.' });
                    updateUser(senderId, { points: user.points - item.price, has_stealer_trap: true });
                    await sock.sendMessage(chatId, { text: '🕸️ تم نصب فخ سرقة النقاط على حسابك بالجروب الأول بنجاح! أول عضو يوجه لك تحدياً أو رهان ستسحب منه 25 نقطة فوراً لحسابك.' });
                }
                break;
            }

            case 'حقيبتي': {
                let bag = `💼 *ممتلكات وحقيبة العضو* @${senderId.split('@')[0]} 💼\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
                bag += `🔮 *المستدعى والشريك النشط:* ${user.summon ? STORE_ITEMS[user.summon]?.name || 'لا يوجد' : 'غير متوفر ❌'}\n`;
                bag += `🎖️ *الوسام الموحد:* ${user.badge || 'غير متوفر ❌'}\n`;
                bag += `👑 *ميزة الدخول الملكي:* ${user.has_entrance ? 'مفعلة ونشطة بالجروب الأول ✅' : 'غير متوفرة ❌'}\n`;
                bag += `🛡️ *وثائق التأمين المتوفرة:* ${user.has_insurance} وثيقة حماية من الخسارة.\n`;
                bag += `🔒 *حالة الخزنة المؤمنة:* ${user.has_vault ? `نشطة بالجروب الأول 🔒` : 'غير مفعلة ❌'}\n`;
                bag += `🧪 *إكسير المانا المضاعف:* ${user.has_double_xp ? `نشط ومضاعف بالجروب الأول 🧪` : 'غير نشط ❌'}\n`;
                bag += `👋 *رعاية الترحيب بالجروب الأول:* ${user.has_welcome_sponsor ? 'نشطة كراعٍ للجروب الأول ✅' : 'غير متوفرة ❌'}\n`;
                bag += `🖼 *تصريح أيقونة المتجر:* ${user.purchased_icon ? 'متاح للشحن (أرسل !تطبيق_الأيقونة بالرد على صورة) ✅' : 'غير متوفر ❌'}\n`;
                bag += `🕸️ *فخ سرقة النقاط النشط:* ${user.has_stealer_trap ? 'منصوب بالجروب الأول 🕸️' : 'غير متوفر ❌'}\n\n`;
                bag += `🪙 رصيدك الكلي الموحد حالياً: ${user.points} نقطة.`;
                await sock.sendMessage(chatId, { text: bag, mentions: [senderId] });
                break;
            }

            case 'تطبيق_الأيقونة': {
                if (!user.purchased_icon) {
                    return sock.sendMessage(chatId, { text: '⚠️ لا تملك تصريح تعديل أيقونة الجروب. يرجى شراء التصريح أولاً من المتجر بـ !شراء icon' });
                }
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const imageMessage = quotedMsg?.imageMessage;
                if (!imageMessage) {
                    return sock.sendMessage(chatId, { text: '⚠️ يرجى الرد بالأمر *!تطبيق_الأيقونة* على أي صورة بالجروب لتطبيقها كشعار لجروب المتجر.' });
                }
                try {
                    const stream = await downloadContentFromMessage(imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    const tempPath = `./temp/group_icon_${senderId.split('@')[0]}.jpg`;
                    fs.writeFileSync(tempPath, buffer);
                    await sock.updateProfilePicture(chatId, { url: tempPath });
                    updateUser(senderId, { purchased_icon: false });
                    await sock.sendMessage(chatId, { text: '✅ تم تحديث وتغيير صورة وأيقونة مجموعة المتجر بنجاح بنظام الإدارة الشاملة!' });
                    fs.unlinkSync(tempPath);
                } catch(e) {
                    console.error(e);
                    return sock.sendMessage(chatId, { text: '❌ تعذر تعديل الصورة بسبب قيود الصلاحيات الفنية للنظام.' });
                }
                break;
            }

            case 'اوامر': {
                let cmds = `📖 *دليل أوامر بوابة المتجر الإمبراطوري* 📖\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
                cmds += `!نقاطي - عرض رصيدك المالي الموحد المستورد من الجروب الأول.\n`;
                cmds += `!احصائياتي - إحصائياتك الشاملة وممتلكاتك ودروعك واكتساب شريكك.\n`;
                cmds += `!متجر - استعراض كافة السلع، الأوسمة، وشخصيات الأنمي المتاحة للطلب.\n`;
                cmds += `!شراء [رمز_السلعة] - شراء السلعة وخصم نقاطها وتفعيلها بالجروب الأول.\n`;
                cmds += `!حقيبتي - استعراض كافة مشترياتك وميزاتك النشطة وشريكك الحالي.\n`;
                cmds += `!تطبيق_الأيقونة - لتطبيق صورة الجروب بالرد على الصورة.\n`;
                cmds += `!اوامر - عرض هذا الدليل الإرشادي.`;
                await sock.sendMessage(chatId, { text: cmds });
                break;
            }
        }
    } catch(e) { console.error('خطأ معالجة أوامر المتجر بالنظام:', e); }
}

// ========== مستمع ومعالج الرسائل الواردة بجروب المتجر ==========
function setupMessageListener(sock) {
    sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || !m.messages[0]) return;
        
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.message.protocolMessage) return;
        
        const chatId = msg.key.remoteJid;
        const senderId = msg.key.participant || msg.key.remoteJid;
        if (chatId !== TARGET_GROUP && senderId !== OWNER_NUMBER) return;
        
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        if (chatId === TARGET_GROUP) {
            checkPressure();
            if (pressurePaused) return;
            const isProtected = PROTECTED_NUMBERS.includes(senderId);

            if (!isProtected && /(https?:\/\/[^\s]+)/.test(text)) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch(e) {}
                const user = getUser(senderId);
                const newWarns = Math.min(user.warnings + 1, 3);
                updateUser(senderId, { points: user.points - 20, warnings: newWarns });
                await sock.sendMessage(chatId, { text: `🚫 العضو @${senderId.split('@')[0]} ممنوع نشر الروابط الخارجية! عقوبة: خصم -20 نقطة وإصدار إنذار جديد لك (${newWarns}/3)`, mentions: [senderId] });
                if (newWarns >= 3) {
                    try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                }
                return;
            }

            if (!isProtected && checkSpam(senderId)) {
                const user = getUser(senderId);
                const newWarns = Math.min(user.warnings + 1, 3);
                updateUser(senderId, { warnings: newWarns });
                await sock.sendMessage(chatId, { text: `🗣️ تنبيه بالسبام! العضو @${senderId.split('@')[0]} تم رصد تدفق رسائل سريع منك؛ إصدار إنذار تلقائي لك (${newWarns}/3)`, mentions: [senderId] });
                if (newWarns >= 3) {
                    try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                }
                return;
            }

            if (!isProtected && containsBadWord(text)) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch(e) {}
                const user = getUser(senderId);
                const newWarns = Math.min(user.warnings + 1, 3);
                updateUser(senderId, { points: user.points - 30, warnings: newWarns });
                await sock.sendMessage(chatId, { text: `🤬 تم رصد لفظ محظور من @${senderId.split('@')[0]}! تم حذف الرسالة، عقوبة: خصم -30 نقطة بالإضافة لإنذار (${newWarns}/3)`, mentions: [senderId] });
                if (newWarns >= 3) {
                    try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                }
                return;
            }
        }

        if (!text.startsWith(PREFIX)) return;
        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        if (cmd) await handleCommand(sock, msg, cmd, args);
    });
}

async function startBot() {
    if (stopBot) return;
    const { state, saveCreds } = await useMultiFileAuthState('auth_group2_info');
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['System Store', 'Chrome', '1.0'],
        markOnlineOnConnect: false
    });
    
    sock.ev.on('creds.update', saveCreds);
    setupMessageListener(sock);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            try {
                const qrcode = require('qrcode-terminal');
                qrcode.generate(qr, { small: true });
                console.log('\n▲ امسح كود الـ QR أعلاه برقم الواتساب المخصص لتشغيل منفذ المتجر الأسطوري ▲\n');
            } catch (e) {
                console.log('تأكد من تثبيت مكتبة qrcode-terminal لتوليد الكود.');
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) { 
                console.log('🚫 تم تسجيل الخروج للنظام.'); 
                stopBot = true; 
                return; 
            }
            reconnectAttempts++;
            const delay = Math.min(2000 * reconnectAttempts, MAX_RECONNECT_DELAY);
            console.log(`🔌 فقدان الاتصال بالنظام؛ جاري إعادة التشغيل خلال ${delay / 1000} ثانية...`);
            setTimeout(startBot, delay);
        } else if (connection === 'open') {
            console.log('🚀 تم الاتصال بنجاح وتفعيل منفذ المتجر الإمبراطوري للجروب الثاني بآيدي الشخصيات الأسطورية!');
            reconnectAttempts = 0;
        }
    });
}

console.log('🚀 جاري تشغيل صراف متجر النظام الموحد للجروب الثاني بآيدي الشخصيات الأسطورية...');
startBot();
