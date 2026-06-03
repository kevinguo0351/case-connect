import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Firebase web config is PUBLIC by design — security is enforced by Firestore
// rules, not by hiding these values. Filled in automatically from
// `firebase apps:sdkconfig` during setup.
const firebaseConfig = {
  apiKey: 'AIzaSyAcy-4Z2YG0akD6jdKfHfGZCK8YJAKdoNY',
  authDomain: 'case-connect-club-9d31c.firebaseapp.com',
  projectId: 'case-connect-club-9d31c',
  storageBucket: 'case-connect-club-9d31c.firebasestorage.app',
  messagingSenderId: '497710891102',
  appId: '1:497710891102:web:32a8f32cd8383c537134cf',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Resolves with the anonymous user's uid (used as the owner of a session doc).
export function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
    signInAnonymously(auth).catch(reject);
  });
}
