async function renderPublicLayout() {
    const currentPage = document.body.getAttribute('data-page');
    const navContainer = document.getElementById('public-nav');
    const footerContainer = document.getElementById('public-footer');
    
    if (!navContainer || !footerContainer) return;

    let user = null;
    try {
        // Phase 5.2: the PHP session decides whether the visitor is logged in.
        // me() refreshes (or clears) the UI cache of the signed-in user before we read it.
        if (api._backendConfig && api._backendConfig.modules.auth && api.auth) await api.auth.me();
        user = await api.getCurrentUser();
    } catch (e) { console.error('[PRIMECARE] getCurrentUser failed:', e); }
    
    // Auth buttons logic
    let authHTML = '';
    if (user) {
        const portalLink = user.role === 'patient' ? 'patient/home.html' : 'staff/dashboard.html';
        authHTML = `<a href="${portalLink}" class="btn btn-primary">Go to my Portal</a>`;
    } else {
        authHTML = `
            <a href="login.html" class="btn btn-outline">Log In</a>
            <a href="register.html" class="btn btn-primary">Register</a>
        `;
    }

    // Navbar
    navContainer.innerHTML = `
        <nav class="public-nav">
            <a href="index.html" class="public-nav-brand">
                <img src="assets/primecare.png" alt="Logo" style="height: 32px; margin-right: 10px; object-fit: contain;">
                PRIME<span>CARE</span>
            </a>
            <button class="mobile-menu-btn" onclick="toggleMobileMenu()" aria-label="Toggle menu">☰</button>
            <div class="public-nav-links" id="nav-links">
                <a href="index.html" class="${currentPage === 'home' ? 'active' : ''}">Home</a>
                <a href="doctors.html" class="${currentPage === 'doctors' ? 'active' : ''}">Find a Doctor</a>
                <a href="departments.html" class="${currentPage === 'departments' ? 'active' : ''}">Departments</a>
                <a href="emergency.html" class="${currentPage === 'emergency' ? 'active' : ''}">Emergency</a>
                <a href="visitor-info.html" class="${currentPage === 'visitor-info' ? 'active' : ''}">Visitor Info</a>
            </div>
            <div class="public-nav-actions" id="nav-actions">
                ${authHTML}
            </div>
        </nav>
    `;

    // Footer
    footerContainer.innerHTML = `
        <footer class="public-footer">
            <div class="footer-grid">
                <div>
                    <div class="footer-brand">PRIME<span>CARE</span></div>
                    <p class="footer-tagline">Your Health, Our Priority.</p>
                    <p class="footer-contact footer-contact-first">📞 (02) 8123-4567</p>
                    <p class="footer-contact">📍 123 Rizal St., Quezon City</p>
                </div>
                <div>
                    <h3>Quick Links</h3>
                    <ul class="footer-links">
                        <li><a href="index.html">Home</a></li>
                        <li><a href="doctors.html">Find a Doctor</a></li>
                        <li><a href="departments.html">Departments</a></li>
                    </ul>
                </div>
                <div>
                    <h3>Patient & Visitor</h3>
                    <ul class="footer-links">
                        <li><a href="emergency.html">Emergency & Wait Times</a></li>
                        <li><a href="visitor-info.html">Visitor Information</a></li>
                        <li><a href="login.html">Patient Portal</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                &copy; ${new Date().getFullYear()} PRIMECARE Hospital Information System. All rights reserved.
            </div>
        </footer>
    `;
}

// Safe wrapper: works whether api methods are sync or async, and logs a clear
// error in the console if a method is missing or throws.
async function safeCall(method, ...args) {
    try {
        if (typeof api === 'undefined' || typeof api[method] !== 'function') {
            console.error(`[PRIMECARE] api.${method} is not defined - check js/api.js`);
            return null;
        }
        return await api[method](...args);
    } catch (e) {
        console.error(`[PRIMECARE] api.${method} failed:`, e);
        return null;
    }
}

function toggleMobileMenu() {
    document.getElementById('nav-links').classList.toggle('open');
    document.getElementById('nav-actions').classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', renderPublicLayout);