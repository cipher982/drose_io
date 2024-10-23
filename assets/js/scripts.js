// Remove console.log and defer animation
document.addEventListener("DOMContentLoaded", () => {
    const codeElement = document.getElementById("codeSnippet");
    if (!codeElement) return;

    // Cache DOM elements and values
    const codeContent = document.documentElement.outerHTML;
    const container = codeElement.parentElement;
    let index = 0;
    let buffer = "";
    const lineLimit = 10;
    let currentLines = 0;
    
    // Adjust these values to control animation speed
    const CHARS_PER_FRAME = 1;
    const FRAME_DELAY = 5;
    
    function typeCode(currentTime) {
        // Process characters per frame
        for (let i = 0; i < CHARS_PER_FRAME && index < codeContent.length; i++) {
            const char = codeContent.charAt(index);
            if (char === "\n") currentLines++;

            buffer += char;

            if (currentLines > lineLimit) {
                buffer = buffer.substring(buffer.indexOf("\n") + 1);
                currentLines--;
            }
            
            index++;
        }

        // Batch DOM updates
        codeElement.textContent = buffer;
        container.scrollTop = container.scrollHeight;

        // Continue animation if not finished
        if (index < codeContent.length) {
            setTimeout(() => requestAnimationFrame(typeCode), FRAME_DELAY);
        }
    }

    setTimeout(() => requestAnimationFrame(typeCode), 100);
});

// Safari detection (if needed)
if (navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome")) {
    document.body.classList.add("safari");
}

// Event delegation for code container click
document.addEventListener("click", (e) => {
    if (e.target.closest("#codeSnippet")) {
        window.location.href = "https://github.com/cipher982/drose_io";
    }
});