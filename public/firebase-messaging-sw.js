// Service worker de Firebase Cloud Messaging.
// Quan el missatge porta "notification", el SDK la mostra sol en segon pla.
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDucFuaBfhqBtMFbHy2rvC3kYQPhLg4OhQ",
  authDomain: "carretons.firebaseapp.com",
  projectId: "carretons",
  storageBucket: "carretons.firebasestorage.app",
  messagingSenderId: "489400188854",
  appId: "1:489400188854:web:b910b894fe35107d43cb17"
});

firebase.messaging();

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
