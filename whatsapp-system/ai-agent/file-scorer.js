const fs = require("fs");
const path = require("path");

function getFiles(dir, out = []) {
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);

        if (fs.statSync(full).isDirectory()) {
            if (!full.includes("node_modules")) {
                getFiles(full, out);
            }
        } else if (f.endsWith(".js")) {
            out.push(full);
        }
    }
    return out;
}

function rankFiles(dir, keywords) {
    const files = getFiles(dir);

    return files.map(f => {
        const content = fs.readFileSync(f, "utf8");
        let score = 0;

        for (const k of keywords) {
            if (content.includes(k)) score++;
        }

        return { filePath: f, score };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
}

module.exports = { rankFiles };
