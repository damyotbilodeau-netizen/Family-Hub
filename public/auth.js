import { auth } from './firebase.js';
import { $ } from './ui.js';
import { initApp } from './main.js';

function setupAuthentication() {
    auth.onAuthStateChanged(user => {
        $("#auth-container").style.display = user ? 'none' : 'flex';
        $("#app-container").style.display = user ? 'flex' : 'none';
        if (user) {
            $("#user-email-display").textContent = user.email;
            initApp();
        }
    });

    $("#login-btn").addEventListener('click', () => {
        const email = $("#email").value;
        const password = $("#password").value;
        auth.signInWithEmailAndPassword(email, password).catch(err => {
            if (err.code === 'auth/user-not-found') {
                auth.createUserWithEmailAndPassword(email, password);
            } else {
                alert(err.message);
            }
        });
    });

    $("#logout-btn").addEventListener('click', () => auth.signOut());
}

export { setupAuthentication };