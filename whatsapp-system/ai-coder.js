const fs = require('fs');
const { execSync } = require('child_process');

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('💡 طريقة الاستخدام: node ai-coder.js [اسم_الملف] "[طلبك]"');
        console.log('📝 مثال: node ai-coder.js public/admin.html "ارفع صندوق الرسائل قليلا وكبر حجمه"');
        process.exit(1);
    }

    const filePath = args[0];
    const userPrompt = args[1];
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.log('❌ خطأ: لم يتم العثور على مفتاح GEMINI_API_KEY في النظام.');
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.log(`❌ خطأ: الملف [${filePath}] غير موجود في هذا المسار.`);
        process.exit(1);
    }

    try {
        // خطوة الأمان: حفظ نسخة تلقائية في جيت قبل التعديل لضمان عدم ضياع كودك
        execSync(`git add "${filePath}"`);
        try { execSync('git commit -m "حفظ تلقائي قبل تعديل الذكاء الاصطناعي"'); } catch (e) {}

        console.log(`⏳ جاري قراءة [${filePath}] وإرساله إلى جيميناي...`);
        const fileContent = fs.readFileSync(filePath, 'utf8');

        const sysInstruction = "You are an expert full-stack developer. You will receive a file content and a user request in Arabic or English to modify it. Modify the code perfectly according to the user request. Return ONLY the complete full source code of the modified file. Do NOT wrap the code in markdown blocks like ```js. Do NOT include any explanations or intro text. Just the raw pure code.";

        const response = await fetch(`[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=$){apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `File: ${filePath}\n\nCode:\n${fileContent}\n\nUser Request: ${userPrompt}` }] }],
                systemInstruction: { parts: [{ text: sysInstruction }] }
            })
        });

        const data = await response.json();
        if (!data.candidates || !data.candidates[0].content.parts[0].text) {
            console.log("❌ فشل جيميناي في الاستجابة، تأكد من تشغيل الـ VPN أو صحة المفتاح.");
            process.exit(1);
        }

        let updatedCode = data.candidates[0].content.parts[0].text.trim();

        // تنظيف الكود إذا وضع الذكاء الاصطناعي علامات التظليل المعتادة ```
        if (updatedCode.startsWith('```')) {
            const lines = updatedCode.split('\n');
            if (lines[0].startsWith('```')) lines.shift();
            if (lines[lines.length - 1].startsWith('```')) lines.pop();
            updatedCode = lines.join('\n');
        }

        fs.writeFileSync(filePath, updatedCode, 'utf8');
        console.log(`\n✅ تم تعديل الملف [${filePath}] بنجاح بناءً على طلبك!`);
        console.log(`💡 جرب مشروعك الآن. إذا لم يعجبك التعديل وتريد التراجع، اكتب فقط: git checkout "${filePath}"`);

    } catch (error) {
        console.error('❌ حدث خطأ أثناء العملية:', error.message);
    }
}

main();
