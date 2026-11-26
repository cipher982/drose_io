// Homepage: buttons marked data-pepper-open open Pepper's chat (pepper.js).
document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-pepper-open]");
    if (!trigger) return;
    if (window.PepperChat && typeof window.PepperChat.open === "function") {
        e.preventDefault();
        window.PepperChat.open();
    }
});
