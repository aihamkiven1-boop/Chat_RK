// ai-agent/intent.js - موديول تحليل النوايا والأهداف البرمجية للطلب المدخل
/**
 * دالة تحليل نية وهدف المطور من الطلب البرمجي المكتوب وتصنيفها
 * @param {string} prompt - طلب المطور الممرر بترمكس
 */
function analyzeIntent(prompt) {
    const cleanPrompt = prompt.toLowerCase().trim();
    const intentResult = {
        action: 'MODIFY_FILE', // الإجراء المركزي الافتراضي والآمن
        category: 'FEATURE_ADDITION', // التصنيف الافتراضي للطلب
        confidence: 1.0,
        targets: []
    };

    // تحليل كلمات البحث الدلالية العربية والإنجليزية لتحديد تصنيف النية بدقة بالغة
    if (cleanPrompt.includes('fix') || cleanPrompt.includes('حل') || cleanPrompt.includes('صلح') || cleanPrompt.includes('إصلاح') || cleanPrompt.includes('خطأ')) {
        intentResult.category = 'BUG_FIX';
    } else if (cleanPrompt.includes('refactor') || cleanPrompt.includes('هيكلة') || cleanPrompt.includes('تقسيم') || cleanPrompt.includes('تنظيف') || cleanPrompt.includes('تصفية')) {
        intentResult.category = 'REFACTORING';
    } else if (cleanPrompt.includes('delete') || cleanPrompt.includes('حذف') || cleanPrompt.includes('إزالة') || cleanPrompt.includes('امسح')) {
        intentResult.category = 'CODE_DELETION';
    } else if (cleanPrompt.includes('optimize') || cleanPrompt.includes('تسريع') || cleanPrompt.includes('تحسين') || cleanPrompt.includes('أداء')) {
        intentResult.category = 'PERFORMANCE_OPTIMIZATION';
    }

    return intentResult;
}

module.exports = { analyzeIntent };
