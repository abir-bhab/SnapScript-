import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDefG3vXEvaLoP_VHacn9-jz-3wkjWInLA",
  authDomain: "snapscribe-app.firebaseapp.com",
  projectId: "snapscribe-app",
  storageBucket: "snapscribe-app.firebasestorage.app",
  messagingSenderId: "975188390971",
  appId: "1:975188390971:web:6d8faa473ebdfe3f1e981e",
  measurementId: "G-XRFZ1SZJMD"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
