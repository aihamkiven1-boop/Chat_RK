// ai-agent/gemini-client.js - موديول الاتصال الفوري والآمن بـ API جوجل لجيل جيميناي 3.5 الفلاش الحديث
const { GoogleGenerativeAI } = require('@google/generative-ai'); // استدعاء حزمة الـ SDK الرسمية الحديثة من جوجل

/**
 * دالة الاتصال وإرسال السياق والطلب لـ Gemini وجلب الرد المطور الآمن
 * @param {Object} contextPayload - كائن السياق الممرر من باني السياق (التعليمات، الملفات، والطلب)
 */
async function callGeminiAPI(contextPayload) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("لم يتم العثور على مفتاح GEMINI_API_KEY في متغيرات البيئة لترمكس.");
    }

    // تهيئة كائن الاتصال الرسمي والحديث بجوجل Generative AI
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // تهيئة وتثبيت الموديل الأحدث بواجهتك gemini-3.5-flash مع تمرير التعليمات الفوقية الصارمة لحماية السيرفر
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
        systemInstruction: contextPayload.systemInstruction // حقن التعليمات الفوقية المأمنة والصلبة تلقائياً من القرص
    });

    // بناء وتنسيق محتويات وأكواد الملفات المستهدفة بدقة متناهية ليفهمها الذكاء الاصطناعي
    let filesPromptContent = "";
    contextPayload.filesContext.forEach(file => {
        filesPromptContent += `\n--- START OF FILE ${file.fileName} ---\n${file.content}\n--- END OF FILE ${file.fileName} ---\n`;
    });

    // صياغة برومبت ذكي ومحدد جداً يمنع الـ API من ثرثرة النصوص ويوجهه للتعديل المباشر كلياً
    const finalPrompt = `
    You are an expert self-healing watchdog. You are analyzing the following codebase files:
    ${filesPromptContent}

    The developer's instruction is:
    "${contextPayload.userPrompt}"

    Please inspect the files, execute the requested modifications precisely, and return ONLY the completely corrected and updated code for the target files. 
    Do not include any explanations, markdown outside the code block, or conversational text. Just return the valid ready-to-write javascript/HTML code.
    `;

    const result = await model.generateContent(finalPrompt);
    const responseText = result.response.text().trim();

    return responseText;
}

module.exports = { callGeminiAPI };
