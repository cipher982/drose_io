// Homepage: buttons marked data-pepper-open open Pepper's chat (pepper.js).
document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-pepper-open]");
    if (!trigger) return;
    if (window.PepperChat && typeof window.PepperChat.open === "function") {
        e.preventDefault();
        window.PepperChat.open();
    }
});

// Looping product videos (.loop-video): play only while visible on screen,
// pause otherwise. With reduced motion, show a still frame and never play.
(() => {
    const videos = Array.from(document.querySelectorAll("video.loop-video"));
    if (!videos.length) return;
    let reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce) {
        videos.forEach((v) => { if (v.dataset.still) v.poster = v.dataset.still; });
        return;
    }
    if (!("IntersectionObserver" in window)) return;
    const shown = (v) => v.offsetParent !== null; // hidden by the breakpoint rule
    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            const v = e.target;
            if (e.isIntersecting && e.intersectionRatio >= 0.35 && shown(v)) {
                if (v.preload !== "auto") v.preload = "auto";
                const p = v.play();
                if (p && p.catch) p.catch(() => {});
            } else {
                v.pause();
            }
        });
    }, { threshold: [0, 0.35, 0.6] });
    videos.forEach((v) => io.observe(v));
})();
