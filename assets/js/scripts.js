document.addEventListener("DOMContentLoaded", function() {
    console.log("Page loaded!");
});

const codeContent = document.documentElement.outerHTML;
let index = 0;
const codeElement = document.getElementById("codeSnippet");
const lineLimit = 9;
let currentLines = 0;

function typeCode() {
    if (index < codeContent.length) {
        const char = codeContent.charAt(index);

        if (char === '\n') {
            currentLines++;
        }

        if (currentLines > lineLimit) {
            // Remove the first line from the text content
            const firstNewLineIndex = codeElement.textContent.indexOf('\n') + 1;
            codeElement.textContent = codeElement.textContent.substring(firstNewLineIndex);
            currentLines--;  // Adjust the line count after removing a line
        }

        codeElement.textContent += char;
        index++;
        setTimeout(typeCode, 50);

        // Scroll to the bottom
        codeElement.parentElement.scrollTop = codeElement.parentElement.scrollHeight;
    }
}

typeCode();

codeElement.addEventListener("click", function() {
    window.location.href = "https://github.com/cipher982/drose_io";
});
