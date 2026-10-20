const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto'); // [مطور ومحدّث] مضاف كلياً لحل مشكلة التشفير المباشر وإقلاع السيرفر بسلام

const app = express();
const server = http.createServer(app);

// إجبار السيرفر على استخدام قنوات الـ WebSockets الصافية فقط لثبات هائل
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket'],
    pingInterval: 25000, 
    pingTimeout: 20000   
});

const PORT = 3000;

// ========== مسارات قاعدة البيانات وصور الأفاتار ==========
const DB_FILE = path.join(__dirname, 'database.db');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// إنشاء اتصال نشط بقاعدة بيانات SQLite وتفعيل ميزة busyTimeout لمنع تعليق الاستعلامات
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (!err) {
        db.configure("busyTimeout", 10000); // الانتظار التلقائي لـ 10 ثوانٍ لمنع أخطاء الـ Database is locked
    }
});

// دالة مساعدة لتشغيل استعلامات SQLite بصيغة متزامنة لتبسيط الـ Sockets والمسارات
function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// تهيئة جداول قاعدة البيانات SQLite والبيانات الأولية عند بدء الإقلاع
async function bootstrapDatabases() {
    // 1. تفعيل وضع الـ WAL لـ SQLite لتوازي القراءة والكتابة
    await dbRun(`PRAGMA journal_mode=WAL;`);

    // 2. جدول المستخدمين الشامل
    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            passcode_hash TEXT,
            points INTEGER DEFAULT 0,
            warnings INTEGER DEFAULT 0,
            correct_answers INTEGER DEFAULT 0,
            total_attempts INTEGER DEFAULT 0,
            last_win INTEGER,
            birthday TEXT,
            daily_gift_claimed TEXT,
            challenge_wins INTEGER DEFAULT 0,
            avatar TEXT,
            banned INTEGER DEFAULT 0,
            name_changes_count INTEGER DEFAULT 0,
            last_name_change_date INTEGER,
            debts TEXT,
            partners TEXT
        )
    `);

    // 3. إنشاء فهرس لعمود النقاط بجدول المستخدمين لسرعة وجلب الترتيب
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC);`);

    // 4. جدول رموز الدخول المصرح بها
    await dbRun(`
        CREATE TABLE IF NOT EXISTS allowed_passcodes (
            passcode_hash TEXT PRIMARY KEY
        )
    `);

    // 5. جدول إعدادات وتواقيت النظام
    await dbRun(`
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            val TEXT
        )
    `);

    // 6. جدول أرشيف وسجلات الأسئلة
    await dbRun(`
        CREATE TABLE IF NOT EXISTS questions_history (
            question TEXT,
            timestamp INTEGER
        )
    `);

    // 7. جدول حفظ التحديات المعلقة
    await dbRun(`
        CREATE TABLE IF NOT EXISTS pending_challenges (
            id TEXT PRIMARY KEY,
            challenger_id TEXT,
            category TEXT,
            timestamp INTEGER
        )
    `);

    // 8. جدول حفظ الرهانات المعلقة
    await dbRun(`
        CREATE TABLE IF NOT EXISTS pending_bets (
            id TEXT PRIMARY KEY,
            challenger_id TEXT,
            amount INTEGER,
            category TEXT,
            timestamp INTEGER
        )
    `);

    // 9. جدول حفظ التحديات المباشرة النشطة
    await dbRun(`
        CREATE TABLE IF NOT EXISTS active_challenges (
            user_id TEXT PRIMARY KEY,
            opponent_id TEXT,
            question_q TEXT,
            question_a TEXT,
            answering_locked INTEGER DEFAULT 0
        )
    `);

    // 10. جدول حفظ الرهانات الجارية
    await dbRun(`
        CREATE TABLE IF NOT EXISTS active_bets (
            challenger_id TEXT PRIMARY KEY,
            opponent_id TEXT,
            pool INTEGER,
            question_q TEXT,
            question_a TEXT,
            answering_locked INTEGER DEFAULT 0
        )
    `);

    // 11. جدول حفظ رسائل الدردشة
    await dbRun(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT,
            text TEXT,
            is_system INTEGER DEFAULT 0,
            timestamp TEXT
        )
    `);

    // تعيين التوقيت الأسبوعي الافتراضي
    const weekStartSetting = await dbGet(`SELECT val FROM system_settings WHERE key = 'weekStart'`);
    if (!weekStartSetting) {
        await dbRun(`INSERT INTO system_settings (key, val) VALUES ('weekStart', ?)`, [Date.now().toString()]);
    }

    // إدراج وحفظ رموز الدخول الافتراضية
    const ALLOWED_PASSCODES_RAW = ["000555", "111333", "555666", "888111", "333000", "555888", "999222", "444777", "777999", "000100"];
    for (const code of ALLOWED_PASSCODES_RAW) {
        const hash = crypto.createHash('sha256').update(code).digest('hex');
        await dbRun(`INSERT OR IGNORE INTO allowed_passcodes (passcode_hash) VALUES (?)`, [hash]);
    }

    // تعقيم دوري تلقائي لحسابات الأنظمة القديمة
    await dbRun(`DELETE FROM users WHERE passcode_hash IS NULL AND points = 0`);

    // [معالج ومطور كلياً] استدعاء وحقن معالج أحداث السوكتس والنزالات والدردشة بالكامل كملف مستقل
    require('./socketHandler')(io, db, { dbRun, dbGet, dbAll });
}
bootstrapDatabases();

// استدعاء وحقن مسارات الـ HTTP والـ API كملف مستقل مفرز
const routes = require('./routes')(db, dbAll);
app.use('/', routes);

server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`خادم المتصفح التفاعلي للنظام يعمل الآن بنجاح على المنفذ: ${PORT}`);
    console.log(`===================================================`);
});
