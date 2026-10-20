// ai-agent/ai-coder.js - المنفذ العام والأمان للـ Agent التلقائي المطور في ترمكس
const fs = require('fs').promises;
const path = require('path');
const { buildContext } = require('./context-builder');
const { callGeminiAPI } = require('./gemini-client');

/**
 * دالة التشغيل المركزي لترقية وتعديل ملفات اللعبة تلقائياً بترمكس عبر الـ API
 */
async function runAICoder() {
    console.log("🚀 running AI coder...");

    // قراءة وتفكيك معاملات سطر الأوامر بترمكس
    const args = process.argv.slice(2);
    const targetFile = args[0];
    const prompt = args[1];

    if (!targetFile || !prompt) {
        console.error("❌ خطأ: التنسيق المطلوب لتشغيل المطور المحلي هو:");
        console.error("node ai-agent/ai-coder.js [اسم_الملف] [الطلب_البرمجي]");
        process.exit(1);
    }

    // تنظيف وتحديد المسارات النسبية والكلية للمشروع الموحد
    const rootDir = path.join(__dirname, '..');
    const targetFilePath = path.join(rootDir, targetFile.replace(/^\/+/, '').trim());

    try {
        // 1. التحقق من وجود الملف المستهدف محلياً بقراءة أولية
        let fileExists = true;
        let originalContent = "";
        try {
            originalContent = await fs.readFile(targetFilePath, 'utf-8');
        } catch (e) {
            fileExists = false; // ملف جديد سيتم إنشاؤه بالكامل من الصفر
        }

        // 2. بناء السياق المأمن وحقن التعليمات الفوقية تلقائياً من القرص
        const contextPayload = await buildContext(prompt, [targetFile]);

        // 3. الاتصال الفوري بـ API جوجل لـ gemini-3.5-flash وجلب الرد المحدث
        const responseText = await callGeminiAPI(contextPayload);

        // 4. استخلاص الأكواد الصافية وتطهيرها من الـ Markdown بكافة صيغها البرمجية
        let cleanCode = responseText.trim();
        if (responseText.includes("```javascript")) {
            cleanCode = responseText.split("```javascript")[1].split("```")[0].trim();
        } else if (responseText.includes("```html")) {
            cleanCode = responseText.split("```html")[1].split("```")[0].trim();
        } else if (responseText.includes("```css")) {
            cleanCode = responseText.split("```css")[1].split("```")[0].trim();
        } else if (responseText.includes("```")) {
            cleanCode = responseText.split("```")[1].split("```")[0].trim();
        }

        // 5. الفحص الأمني قبل الحفظ والتعديل بالقرص لحماية سلامة المشروع
        if (!cleanCode || cleanCode.length < 30) {
            console.error("❌ خطأ: فشل المساعد في استخلاص كود نظيف لإجراء التعديل الفعلي بترمكس.");
            process.exit(1);
        }

        // 6. حفظ نسخة احتياطية آمنة ذات سحبة .bak في حال وجود ملف أصلي مسبقاً بالقرص
        if (fileExists) {
            const backupPath = `${targetFilePath}.bak`;
            await fs.writeFile(backupPath, originalContent, 'utf-8');
            console.log(`🧷 backup: ${targetFile}.bak`);
        }

        // 7. كتابة وحفظ الملف المطور الجديد بالقرص بنجاح واستقرار تام
        await fs.writeFile(targetFilePath, cleanCode, 'utf-8');
        console.log(`📊 changes detected: ${cleanCode.length}`);
        console.log(`✅ updated: ${targetFile}`);

    } catch (err) {
        console.error("❌ خطأ برمجائي فادح أثناء معالجة تشغيل الـ AI Coder: ", err);
        process.exit(1);
    }
}

// إطلاق موديول المطور
runAICoder();
