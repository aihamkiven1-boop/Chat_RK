// routes.js - موديول مسارات الـ HTTP والـ API لقراءة الصدارة وقاعدة البيانات آمنة ومفرزة كلياً
const express = require('express');
const path = require('path');
const router = express.Router();

module.exports = function(db, dbAll) {
    
    // 1. مسار صفحة الشات الرئيسية للاعبين
    router.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'player.html'));
    });

    // 2. مسار لوحة الشرف والصدارة الحية للمتصفح
    router.get('/leaderboard.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
    });

    // 3. مسار لوحة تحكم المشرف والأدمن الرصد والـ CCTV
    router.get('/admin.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    });

    // 4. [مأمن ومصحح كلياً] منفذ الـ API لاستيراد وحساب الصدارة التلقائية مع حجب تشفيرات الرموز الحساسة للاعبين لحمايتها من الكشف
    router.get('/users_db.json', async (req, res) => {
        try {
            const rows = await dbAll(`SELECT * FROM users`);
            const result = {};
            for (const row of rows) {
                result[row.id] = {
                    points: row.points,
                    warnings: row.warnings,
                    correctAnswers: row.correct_answers,
                    totalAttempts: row.total_attempts,
                    lastWin: row.last_win,
                    birthday: row.birthday,
                    dailyGiftClaimed: row.daily_gift_claimed,
                    challengeWins: row.challenge_wins,
                    debts: JSON.parse(row.debts || '[]'),
                    avatar: row.avatar,
                    banned: !!row.banned,
                    nameChangesCount: row.name_changes_count,
                    lastNameChangeDate: row.last_name_change_date,
                    partners: JSON.parse(row.partners || '{}')
                };
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: "تعذر استيراد الصدارة وقاعدة البيانات" });
        }
    });

    return router;
};
