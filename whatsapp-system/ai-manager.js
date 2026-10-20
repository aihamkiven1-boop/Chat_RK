// ai-manager.js - الحارس الصامت ومراقب التشغيل التلقائي المطور بـ SDK جوجل الرسمي ونموذج Gemini 2.5 Pro العملاق
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // استدعاء حزمة جوجل الرسمية الحديثة المصدقة

// التحقق من وجود مفتاح الـ API بمتغيرات بيئة نظام التشغيل
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ خطأ: لم يتم العثور على مفتاح GEMINI_API_KEY في متغيرات البيئة لترمكس.');
    console.error('يرجى تصديره أولاً بترمكس كـ: export GEMINI_API_KEY="مفتاحك_الخاص_المبتدئ_بـ_AIzaSy"');
    process.exit(1);
}

// تهيئة كائن الاتصال الرسمي والحديث بجوجل Generative AI
const genAI = new GoogleGenerativeAI(apiKey);
// [مطور ومحدّث كلياً] استخدام النموذج العملاق 2.5 برولقدرات التقصي والبحث والتحليل البرمجي الفائق للأخطاء المعقدة
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

let errorBuffer = "";

function startServer() {
    console.log("🚀 جاري تشغيل وإطلاق خادم اللعبة (server.js) تحت المراقبة التلقائية الحية...");
    errorBuffer = ""; // إعادة تعيين مجمع الأخطاء قبل الإقلاع الجديد

    const server = spawn('node', ['server.js']);

    // توجيه السجلات مباشرة لشاشة ترمكس حياً ودون تعليق عبر ممر stdout
    server.stdout.on('data', (data) => {
        process.stdout.write(data);
    });

    server.stderr.on('data', (data) => {
        process.stderr.write(data);
        errorBuffer += data.toString(); // تجميع وتكديس تفاصيل الانهيار لإرسالها للـ API
    });

    server.on('close', async (code) => {
        console.log(`⚠️ السيرفر أغلق برمز الخروج: ${code}`);

        if (code === 0) {
            // خروج طبيعي ومأمن كلياً (عند طلب أمر !تحديث الإداري) -> إعادة تشغيل فوري دون فحص الذكاء
            console.log("🔄 جاري إعادة تشغيل السيرفر تلقائياً لتطبيق التحديثات البرمجية خلال ثانيتين... ⏱️");
            setTimeout(startServer, 2000);
        } else {
            // انهيار غير متوقع للسيستم بترمكس نتيجة لوجود خطأ في الكود
            console.log("💥 انهيار غير متوقع للعبة! جاري استدعاء الـ API من جوجل لتحليل الخلل وإصلاحه تلقائياً...");
            await attemptSelfHealing(errorBuffer);
            console.log("🔄 جاري إعادة التشغيل التلقائي الآمن بعد محاولة الإصلاح الذاتي...");
            setTimeout(startServer, 3000);
        }
    });
}

async function attemptSelfHealing(errorLog) {
    if (!errorLog) {
        console.log("🔍 لم يتم رصد أي تفاصيل للخطأ في بافر stderr لترمكس.");
        return;
    }

    try {
        // محلل الأخطاء: تتبع الملف المتسبب بالانهيار تلقائياً من سجل الخطأ
        let targetFile = "server.js";
        if (errorLog.includes("socketHandler.js")) {
            targetFile = "socketHandler.js";
        } else if (errorLog.includes("partners.js")) {
            targetFile = "partners.js";
        }

        console.log(`🎯 تم رصد الخلل بملف [ ${targetFile} ]، جاري قراءته لإرساله إلى جوجل...`);
        const filePath = path.join(__dirname, targetFile);
        const fileContent = await fs.readFile(filePath, 'utf-8');

        // صياغة برومبت ذكي ومحدد جداً ليقوم الـ API بإرجاع الكود الصافي دون ثرثرة تفادياً للتضخم
        const prompt = `
        You are an expert self-healing watchdog. The following Node.js program crashed with this error log:
        \`\`\`
        ${errorLog}
        \`\`\`

        Here is the complete source code of the affected file [${targetFile}]:
        \`\`\`javascript
        ${fileContent}
        \`\`\`

        Please analyze the error, find the exact bug (e.g., syntax error, missing require, undefined variable, column mismatch), fix it, and return ONLY the completely corrected and updated javascript code. Do not include any explanations, markdown outside the code block, or comments. Just return the valid ready-to-write javascript code.
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        // استخلاص كود الجافاسكربت النظيف والآمن من رد جوجل المفسر
        let cleanCode = responseText;
        if (responseText.includes("```javascript")) {
            cleanCode = responseText.split("```javascript")[1].split("```")[0].trim();
        } else if (responseText.includes("```")) {
            cleanCode = responseText.split("```")[1].split("```")[0].trim();
        }

        if (cleanCode && cleanCode.length > 50) {
            // عمل نسخة احتياطية للملف القديم قبل الكتابة لتأمين كود المطور
            await fs.writeFile(`${filePath}.bak`, fileContent, 'utf-8');
            await fs.writeFile(filePath, cleanCode, 'utf-8');
            console.log(`✅ نجح المصلح التلقائي في إصلاح وحفظ الملف [ ${targetFile} ] بسلام! تم عمل نسخة احتياطية باسم [ ${targetFile}.bak ].`);
        } else {
            console.log("❌ فشل المساعد في استخلاص كود نظيف لإجراء الإصلاح التلقائي في ترمكس.");
        }
    } catch (err) {
        console.error("❌ خطأ أثناء محاولة الإصلاح الذاتي عبر Google AI API:", err);
    }
}

// البدء المباشر لمراقب السيرفر
startServer();
