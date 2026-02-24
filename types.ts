export enum UserRole {
  REQUESTER = 'requester',
  RUNNER = 'runner',
  ADMIN = 'admin',
  TESTER = 'tester'
}

export enum ErrandStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  VERIFYING = 'verifying', // Runner has submitted for review
  COMPLETED = 'completed', // Requester has signed off
  CANCELLED = 'cancelled'
}

export enum ErrandCategory {
  GENERAL = 'General',
  HOUSE_HUNTING = 'House Hunting',
  MAMA_FUA = 'Mama Fua',
  SHOPPING = 'Shopping',
  GIKOMBA_STRAWS = 'Gikomba straws',
  TOWN_SERVICE = 'Town Service',
  PACKAGE_DELIVERY = 'Package Delivery'
}

export enum NotificationType {
  NEW_BID = 'new_bid',
  BID_ACCEPTED = 'bid_accepted',
  JOB_SUBMITTED = 'job_submitted',
  JOB_COMPLETED = 'job_completed',
  NEW_MESSAGE = 'new_message',
  NEW_ERRAND = 'new_errand'
}

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  errandId: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationSuggestion {
  name: string;
  coords: Coordinates;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface Bid {
  runnerId: string;
  runnerName: string;
  price: number;
  timestamp: number;
  runnerRating: number;
  eta?: string;
}

export interface Errand {
  id: string;
  category: ErrandCategory;
  title: string;
  description: string;
  budget: number;
  acceptedPrice?: number;
  deadline: string;
  requesterId: string;
  requesterName: string;
  runnerId: string | null;
  status: ErrandStatus;
  createdAt: number;
  pickupLocation: string;
  pickupCoordinates: Coordinates;
  dropoffLocation: string;
  dropoffCoordinates: Coordinates;
  bids: Bid[];
  chat: ChatMessage[];
  distanceKm?: number;
  requesterRating: number;
  calculatedPrice?: number;
  imageUrls?: string[];
  
  // Mama Fua specific
  laundryBaskets?: number;
  laundryInHouseLocation?: string;
  preferredDate?: string;
  isInHouse?: boolean;
  
  // House Hunting specific
  minBudget?: number;
  maxBudget?: number;
  houseType?: string;
  moveInDate?: string;
  additionalRequirements?: string;
  
  // Verification
  runnerComments?: string;
  completionPhoto?: string;
  signature?: string;
  completedAt?: number;
  
  // Reassignment
  reassignmentRequested?: boolean;
  reassignReason?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  runnerCategory?: ErrandCategory;
  isAdmin?: boolean;
  isVerified: boolean;
  rating: number;
  ratingCount: number;
  createdAt: number;
  avatar?: string;
  biography?: string;
  isOnline?: boolean;
  lastKnownLocation?: Coordinates;
  balanceOnHold?: number;
  balanceWithdrawn?: number;
  notificationSettings?: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  theme?: 'light' | 'dark';
}

export interface AppSettings {
  primaryColor: string;
  logoUrl?: string;
  iconUrl?: string;
}

export interface RunnerApplication {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  nationalId: string;
  idFrontUrl: string;
  idBackUrl: string;
  categoryApplied: ErrandCategory;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export interface FeaturedService {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  category: ErrandCategory;
  explanation?: string;
  paymentGuide?: string;
  createdAt: number;
}

export interface ServiceListing {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  category: ErrandCategory;
  scope?: string;
  explanation?: string;
  paymentGuide?: string;
  createdAt: number;
}
