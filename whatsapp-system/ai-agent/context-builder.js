// ai-agent/context-builder.js - موديول باني السياق المطور لجمع وقراءة الأكواد وحقن التعليمات الفوقية تلقائياً
const fs = require('fs').promises;
const path = require('path');

/**
 * دالة بناء سياق الطلب لـ Gemini بالاعتماد على قواعد الحماية وفهرسة الملفات المستهدفة محلياً
 * @param {string} prompt - طلب المطور المكتوب في الشات
 * @param {Array<string>} targetFiles - مصفوفة الملفات المستهدفة بالتعديل
 */
async function buildContext(prompt, targetFiles) {
    const contextPayload = {
        systemInstruction: "",
        userPrompt: prompt,
        filesContext: []
    };

    // الخروج الآمن من مجلد ai-agent الفرعي إلى المجلد الرئيسي للمشروع
    const rootDir = path.join(__dirname, '..');

    // 1. قراءة وحقن التعليمات الفوقية المأمنة والصلبة تلقائياً من القرص
    try {
        const instructionsPath = path.join(__dirname, 'system-instructions.txt');
        contextPayload.systemInstruction = await fs.readFile(instructionsPath, 'utf-8');
    } catch (err) {
        // في حال فقدان الملف، توفير تعليمات برمجية تأسيسية عامة لحماية السيرفر من تضارب الذاكرة
        contextPayload.systemInstruction = "ROLE: Expert Node.js developer. Maintain existing SQLite single connection, prevent XSS via escapeHtml, and preserve backward compatibility.";
    }

    // 2. قراءة وتجميع محتويات الملفات المستهدفة بالتعديل محلياً بدقة ومنع التكرار
    for (const file of targetFiles) {
        try {
            // تنظيف مسار الملف الممرر للتأكد من سلامة القراءة بترمكس
            const cleanPath = file.replace(/^\/+/, '').trim();
            const absolutePath = path.join(rootDir, cleanPath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            
            contextPayload.filesContext.push({
                fileName: cleanPath,
                content: content
            });
        } catch (e) {
            // تجاهل وتخطي الملفات المفقودة أو التي لم يتم إنشاؤها بعد ليعالجها الـ Agent تلقائياً كملف جديد
        }
    }

    return contextPayload;
}

module.exports = { buildContext };
