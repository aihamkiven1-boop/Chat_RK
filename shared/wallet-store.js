0) {
            const err = new Error('رصيدك غير كافٍ لإتمام عملية الشراء.');
            err.code = 'INSUFFICIENT_POINTS';
            throw err;
        }
        all[id].points -= price;
        Object.assign(all[id], effects);
        return {changed: true, value: structuredClone(all[id])};
    });
}

module.exports = {enabled, file, all, getOrCreate, update, purchase};
