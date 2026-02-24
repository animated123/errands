
/**
 * FIRESTORE SECURITY RULES (Documentation)
 * 
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     
 *     // User profiles
 *     match /users/{userId} {
 *       allow read: if request.auth != null;
 *       allow write: if request.auth != null && request.auth.uid == userId;
 *     }
 *     
 *     // Errands
 *     match /errands/{errandId} {
 *       allow read: if request.auth != null;
 *       
 *       // Only requesters can create errands
 *       allow create: if request.auth != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'requester';
 *       
 *       // Requesters can update their own errands (if not accepted)
 *       // Runners can update errands they have accepted
 *       allow update: if request.auth != null && (
 *         (request.auth.uid == resource.data.requesterId && resource.data.status == 'pending') ||
 *         (request.auth.uid == resource.data.runnerId) ||
 *         (resource.data.status == 'pending' && request.resource.data.status == 'accepted' && request.resource.data.runnerId == request.auth.uid)
 *       );
 *     }
 *   }
 * }
 */

export const APP_THEME = {
  primary: '#4f46e5', // indigo-600
  secondary: '#10b981', // emerald-500
  accent: '#f59e0b', // amber-500
  background: '#f9fafb',
  card: '#ffffff'
};
