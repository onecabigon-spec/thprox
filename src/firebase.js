import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBtbxDZSLCSE-FDGuPCEzG0HlTVz3Llvrc",
  authDomain: "thpro-by-cabi.firebaseapp.com",
  projectId: "thpro-by-cabi",
  storageBucket: "thpro-by-cabi.firebasestorage.app",
  messagingSenderId: "154872990219",
  appId: "1:154872990219:web:a27f64cc3df970b9ee550e",
  measurementId: "G-7LE2C08DD4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
