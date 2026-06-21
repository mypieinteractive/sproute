const fs = require('fs');

const idx = fs.readFileSync('index.html', 'utf8');
console.log("Checking for inspector filter block...");
if (idx.includes('inspector-dropdown-wrapper')) {
    console.log("Found dropdown wrapper in HTML");
}
