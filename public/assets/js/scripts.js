document.addEventListener("DOMContentLoaded", () => {
    const codeElement = document.getElementById("codeSnippet");
    if (!codeElement) return;

    // Defer + pause work: only animate while in/near view and tab is visible.
    const container = codeElement.parentElement;
    let running = false;
    let inView = false;
    let rafId = 0;

    const MAX_CHARS = 4000;
    const lineLimit = 8;
    const targetFps = 30;
    const charsPerTick = 6;

    let codeContent = null;

    function ensureContent() {
        if (codeContent !== null) return;
        const fullHTML = document.documentElement.outerHTML;
        codeContent = fullHTML.slice(0, Math.min(MAX_CHARS, fullHTML.length));
    }

    let index = 0;
    let currentLine = "";
    let lines = [];
    let lastFrame = 0;

    function render() {
        const view = lines.slice(-lineLimit);
        const text = [...view, currentLine].join("\n");
        codeElement.textContent = text;
    }

    function reset() {
        index = 0;
        currentLine = "";
        lines = [];
        render();
    }

    function tick(now) {
        if (!running) return;

        if (now - lastFrame < 1000 / targetFps) {
            rafId = requestAnimationFrame(tick);
            return;
        }
        lastFrame = now;

        if (codeContent === null) {
            ensureContent();
            if (codeContent === null) return;
        }

        for (let i = 0; i < charsPerTick; i++) {
            if (index >= codeContent.length) {
                reset();
                break;
            }

            const char = codeContent.charAt(index++);
            if (char === "\n") {
                lines.push(currentLine);
                currentLine = "";
                if (lines.length > lineLimit * 3) {
                    // avoid unbounded growth while still allowing a rolling buffer
                    lines = lines.slice(-lineLimit * 2);
                }
            } else {
                currentLine += char;
            }
        }

        render();
        rafId = requestAnimationFrame(tick);
    }

    function start() {
        if (running) return;
        ensureContent();
        running = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
    }

    function updateRunning(shouldRun) {
        inView = shouldRun;
        if (shouldRun && document.visibilityState === "visible") start();
        else stop();
    }

    const onVisibility = () => updateRunning(inView);
    document.addEventListener("visibilitychange", onVisibility, { passive: true });

    if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
            const entry = entries[0];
            updateRunning(Boolean(entry && entry.isIntersecting));
        }, { rootMargin: "200px" });
        io.observe(container);
    } else {
        // Fallback: run after user interaction, then pause when tab is hidden
        const startOnce = () => {
            updateRunning(true);
            document.removeEventListener("scroll", startOnce);
            document.removeEventListener("click", startOnce);
        };
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
