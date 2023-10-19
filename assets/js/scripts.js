document.addEventListener("DOMContentLoaded", function() {
    console.log("Page loaded!");
});

const codeContent = document.documentElement.outerHTML;
let index = 0;
const codeElement = document.getElementById("codeSnippet");
const lineLimit = 10;
let currentLines = 0;
let buffer = '';
let delay = 5; // delay in milliseconds
let lastCallTime;

if (navigator.userAgent.search("Safari") >= 0 && navigator.userAgent.search("Chrome") < 0) {
    document.body.classList.add("safari");
}

function typeCode(currentTime) {
    if (index >= codeContent.length) return;
    
    if (!lastCallTime || currentTime - lastCallTime >= delay) {
        const char = codeContent.charAt(index);
        if (char === '\n') {
            currentLines++;
        }

        buffer += char;

        if (currentLines > lineLimit) {
            const firstNewLineIndex = buffer.indexOf('\n') + 1;
            buffer = buffer.substring(firstNewLineIndex);
            currentLines--;
        }

        // Directly update DOM in one go
        codeElement.textContent = buffer;

        // Scroll to the bottom
        codeElement.parentElement.scrollTop = codeElement.parentElement.scrollHeight;

        index++;
        lastCallTime = currentTime;
    }

    // Use requestAnimationFrame for smoother experience
    requestAnimationFrame(typeCode);
}

// Kickstart the animation
requestAnimationFrame(typeCode);

codeElement.addEventListener("click", function() {
    window.location.href = "https://github.com/cipher982/drose_io";
});
