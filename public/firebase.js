// --- INITIALISATION FIREBASE ---
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

export { auth, db };