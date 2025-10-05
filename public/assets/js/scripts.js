// Remove console.log and defer animation
document.addEventListener("DOMContentLoaded", () => {
    const codeElement = document.getElementById("codeSnippet");
    if (!codeElement) return;

    // Defer heavy work until the code container is actually in view
    const container = codeElement.parentElement;
    let started = false;

    function startAnimation() {
        if (started) return;
        started = true;

        // Use a capped slice of the DOM to reduce work
        const MAX_CHARS = 4000;
        const fullHTML = document.documentElement.outerHTML;
        const codeContent = fullHTML.slice(0, Math.min(MAX_CHARS, fullHTML.length));

        let index = 0;
        let buffer = "";
        const lineLimit = 8; // Reduced to fit container better
        let currentLines = 0;

        const CHARS_PER_FRAME = 2;
        const FRAME_DELAY = 6;

        function typeCode() {
            for (let i = 0; i < CHARS_PER_FRAME && index < codeContent.length; i++) {
                const char = codeContent.charAt(index);
                if (char === "\n") currentLines++;
                buffer += char;
                index++;
            }

            // Keep only the last N lines to ensure typing stays visible
            if (currentLines > lineLimit) {
                const lines = buffer.split('\n');
                buffer = lines.slice(-lineLimit).join('\n');
                currentLines = lineLimit;
            }

            codeElement.textContent = buffer;

            if (index < codeContent.length) {
                setTimeout(() => requestAnimationFrame(typeCode), FRAME_DELAY);
            } else {
                // Reset and loop immediately
                index = 0;
                buffer = "";
                currentLines = 0;
                codeElement.textContent = "";
                setTimeout(() => requestAnimationFrame(typeCode), FRAME_DELAY);
            }
        }

        // small delay to avoid competing with initial paint
        setTimeout(() => requestAnimationFrame(typeCode), 120);
    }

    if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    startAnimation();
                    io.disconnect();
                }
            });
        }, { rootMargin: "100px" });
        io.observe(container);
    } else {
        // Fallback: start after user interaction to avoid impacting initial load
        const startOnce = () => { startAnimation(); document.removeEventListener("scroll", startOnce); document.removeEventListener("click", startOnce); };
        document.addEventListener("scroll", startOnce, { passive: true });
        document.addEventListener("click", startOnce, { passive: true });
    }
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
