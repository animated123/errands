import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Plus, MapPin, DollarSign, Calendar, Briefcase, 
  CheckCircle, Star, Camera, Navigation, Clock, Map as MapIcon, 
  List, ChevronLeft, LogOut, Search, Info,
  Phone, Mail, Globe, MapPinned, UserCheck, Loader2,
  ArrowRight, CreditCard, X, BellRing, Target,
  Wallet, MessageSquare, Sparkles, Key,
  Home, Calculator, Tag, AlertCircle, Trash2, Waves, Check,
  Zap, CameraOff, Image as ImageIcon, Maximize2, ShieldAlert, ShoppingBag, 
  Settings, Palette, ImageIcon as LucideImageIcon, UserMinus, Edit2, Save, Upload,
  HelpCircle, ChevronRight, MessageCircle, PlusCircle, Filter, UserCircle
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { User, UserRole, Errand, ErrandStatus, ErrandCategory, Coordinates, Bid, AppNotification, NotificationType, ChatMessage, AppSettings, LocationSuggestion, RunnerApplication, FeaturedService, ServiceListing } from './types';
import { firebaseService, calculateDistance, formatFirebaseError } from './services/firebaseService';
import { cloudinaryService } from './services/cloudinaryService';
import Layout from './components/Layout';
import ErrandCard from './components/ErrandCard';
import TopProgressBar from './components/TopProgressBar';
import LoadingSpinner from './components/LoadingSpinner';
import AuthModal from './components/AuthModal';
import { ChevronUp, ChevronDown, CheckCircle2 } from 'lucide-react';

const callGeminiWithRetry = async (prompt: string, maxRetries = 3): Promise<string> => {
  if (typeof prompt !== 'string') return "";
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      return response.text || "";
    } catch (err: any) {
      if (i === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
  return "";
};

const CameraCapture: React.FC<{ onCapture: (file: File) => void, onClose: () => void }> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(s => { 
          setStream(s); 
          if (videoRef.current) videoRef.current.srcObject = s; 
        })
        .catch(() => setError("Camera access denied. Please check site permissions."));
    } else {
      setError("Your device does not support camera access.");
    }
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        canvas.toBlob(blob => {
          if (blob) onCapture(new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.8);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black flex flex-col items-center justify-center">
      {error ? (
        <div className="text-white text-center p-8">
          <CameraOff size={48} className="mx-auto mb-4 text-red-500" />
          <p className="font-bold text-lg mb-6">{error}</p>
          <button onClick={onClose} className="px-10 py-4 bg-white text-black rounded-2xl font-black uppercase text-xs">Close</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute top-6 left-6">
            <button onClick={onClose} className="p-4 bg-black/40 backdrop-blur-md rounded-2xl text-white hover:bg-black/60 transition-colors">
              <X size={24} />
            </button>
          </div>
          <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-6">
             <div className="px-4 py-2 bg-black/40 backdrop-blur-md rounded-full text-white text-[10px] font-black uppercase tracking-widest">Capture completion proof</div>
             <button onClick={capture} className="w-20 h-20 bg-white rounded-full border-8 border-white/20 flex items-center justify-center shadow-2xl active:scale-90 transition-all">
               <div className="w-14 h-14 bg-white rounded-full border-4 border-slate-900" />
             </button>
          </div>
        </>
      )}
    </div>
  );
};

const LocationAutocomplete: React.FC<{ label: string, icon: React.ReactNode, placeholder: string, onSelect: (loc: LocationSuggestion | null) => void, value?: string, error?: string, required?: boolean }> = ({ label, icon, placeholder, onSelect, value, error, required }) => {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const isSelected = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { if (value !== undefined && !isSelected.current) setQuery(value); }, [value]);

  const fetch = async (q: string) => {
    if (q.length < 3 || isSelected.current) return;
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find 5 real-world locations or landmarks in Kenya matching "${q}". 
        Return ONLY a JSON array of objects with: name (string), lat (number), lng (number).
        Focus on accuracy for Nairobi and major towns.`,
        config: { responseMimeType: "application/json" }
      });
      const data = JSON.parse(response.text || '[]');
      setSuggestions(data.map((d: any) => ({ name: d.name, coords: { lat: d.lat, lng: d.lng } })));
      setShow(true);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetch(query), 600);
    return () => clearTimeout(timer);
  }, [query]);

  const quickPoints = [
    { name: "Nairobi CBD", coords: { lat: -1.286389, lng: 36.817223 } },
    { name: "Westlands", coords: { lat: -1.2646, lng: 36.8045 } },
    { name: "Kilimani", coords: { lat: -1.2902, lng: 36.7905 } },
    { name: "Mombasa Town", coords: { lat: -4.0435, lng: 39.6682 } }
  ];

  return (
    <div className="space-y-1 relative" ref={dropdownRef}>
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1 ml-1">{icon} {label} {required && "*"}</label>
      <div className="relative">
        <input 
          type="text" value={query} placeholder={placeholder} 
          onChange={e => { isSelected.current = false; setQuery(e.target.value); if (!e.target.value) onSelect(null); }}
          onFocus={() => query.length >= 3 && setShow(true)}
          className={`w-full p-3.5 brand-input rounded-2xl text-sm font-bold outline-none transition-all ${error ? 'border-red-500' : ''}`}
        />
        {loading && <div className="absolute right-4 top-1/2 -translate-y-1/2"><LoadingSpinner size={14} /></div>}
      </div>
      {(!query || query.length < 3) && (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {quickPoints.map((p, idx) => (
            <button key={idx} type="button" onClick={() => { isSelected.current = true; setQuery(p.name); onSelect(p); setShow(false); }} className="px-3 py-1 bg-slate-50 border border-slate-100 rounded-full text-[9px] font-black text-slate-500 uppercase hover:bg-black hover:text-white transition-all">{p.name}</button>
          ))}
        </div>
      )}
      {show && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 shadow-2xl rounded-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onClick={() => { isSelected.current = true; setQuery(s.name); onSelect(s); setShow(false); }} className="w-full text-left p-3.5 hover:bg-slate-50 border-b border-slate-50 last:border-none transition-colors">
              <p className="text-xs font-black text-slate-900">{s.name}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Kenya</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CreateScreen: React.FC<any> = ({ errandForm, setErrandForm, postErrand, loading, errors }) => {
  const totalMamaFuaCost = (errandForm.laundryBaskets || 0) * (errandForm.pricePerBasket || 250);
  
  const handleUpdate = (updates: any) => { 
    const newForm = { ...errandForm, ...updates };
    
    // Auto-calculate budget based on distance for General tasks
    if (newForm.category === ErrandCategory.GENERAL && newForm.pickup && newForm.dropoff && !newForm.isInHouse) {
      const dist = calculateDistance({ lat: newForm.pickup.lat, lng: newForm.pickup.lng }, { lat: newForm.dropoff.lat, lng: newForm.dropoff.lng });
      // Base price 300 + 50 per KM
      const estimatedBudget = 300 + Math.ceil(dist * 50);
      newForm.budget = Math.max(newForm.budget || 0, estimatedBudget);
    }
    
    setErrandForm(newForm); 
  };

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100"><Plus size={24} /></div>
          <div><h2 className="text-base font-[900] text-slate-900">Post an Errand</h2><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Select Category</p></div>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-6">
           {[
             { id: ErrandCategory.GENERAL, label: 'General', icon: <Briefcase size={16} /> },
             { id: ErrandCategory.MAMA_FUA, label: 'Mama Fua', icon: <Waves size={16} /> },
             { id: ErrandCategory.HOUSE_HUNTING, label: 'House Hunt', icon: <Home size={16} /> }
           ].map(cat => (
             <button key={cat.id} type="button" onClick={() => handleUpdate({ category: cat.id, isInHouse: false, pickup: null, dropoff: null })} className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-1.5 ${errandForm.category === cat.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-slate-100 text-slate-400 hover:border-indigo-100'}`}>
               {cat.icon}
               <span className="text-[10px] font-black uppercase tracking-tight">{cat.label}</span>
             </button>
           ))}
        </div>
        <form onSubmit={postErrand} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Task Title <span className="text-red-500">*</span></label>
              <input type="text" required value={errandForm.title} onChange={e => handleUpdate({ title: e.target.value })} placeholder="What needs to be done?" className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Description (Optional)</label>
              <textarea value={errandForm.description} onChange={e => handleUpdate({ description: e.target.value })} placeholder="Details like flat number, specific instructions..." className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none h-24 resize-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
            {errandForm.category === ErrandCategory.GENERAL && (
              <>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <p className="text-xs font-black text-slate-900">In-House Service?</p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Runner comes to your home</p>
                  </div>
                  <button type="button" onClick={() => handleUpdate({ isInHouse: !errandForm.isInHouse, dropoff: null })} className={`w-12 h-6 rounded-full transition-all relative ${errandForm.isInHouse ? 'bg-indigo-600 shadow-lg shadow-indigo-100' : 'bg-slate-200'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${errandForm.isInHouse ? 'left-7' : 'left-1'}`} /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Budget (Ksh) <span className="text-red-500">*</span></label>
                    <input type="number" required value={errandForm.budget || ''} onChange={e => handleUpdate({ budget: parseInt(e.target.value) })} className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Deadline <span className="text-red-500">*</span></label>
                    <input type="datetime-local" required value={errandForm.deadline} onChange={e => handleUpdate({ deadline: e.target.value })} className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                </div>
                <LocationAutocomplete label={errandForm.isInHouse ? "Your Location" : "Pickup"} placeholder={errandForm.isInHouse ? "Where should runner come?" : "Where from?"} icon={<MapPin size={10} />} onSelect={loc => handleUpdate({ pickup: loc })} value={errandForm.pickup?.name} required />
                {!errandForm.isInHouse && <LocationAutocomplete label="Drop-off" placeholder="Where to?" icon={<MapPinned size={10} />} onSelect={loc => handleUpdate({ dropoff: loc })} value={errandForm.dropoff?.name} required />}
              </>
            )}
            {errandForm.category === ErrandCategory.HOUSE_HUNTING && (
              <div className="space-y-4">
                <LocationAutocomplete label="Preferred Location" placeholder="Search estate or area..." icon={<MapPin size={10} />} onSelect={loc => handleUpdate({ pickup: loc })} value={errandForm.pickup?.name} required />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Min Rent (Ksh) <span className="text-red-500">*</span></label>
                    <input type="number" required value={errandForm.minBudget || ''} onChange={e => handleUpdate({ minBudget: parseInt(e.target.value) })} className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Max Rent (Ksh) <span className="text-red-500">*</span></label>
                    <input type="number" required value={errandForm.maxBudget || ''} onChange={e => handleUpdate({ maxBudget: parseInt(e.target.value) })} className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">House Type <span className="text-red-500">*</span></label>
                  <select required value={errandForm.houseType || ''} onChange={e => handleUpdate({ houseType: e.target.value })} className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none appearance-none focus:ring-2 focus:ring-indigo-500/20">
                    <option value="" disabled>Select house type</option>
                    <option value="Bedsitter">Bedsitter</option>
                    <option value="1 Bedroom">1 Bedroom</option>
                    <option value="2 Bedroom">2 Bedroom</option>
                    <option value="3 Bedroom">3 Bedroom</option>
                  </select>
                </div>
              </div>
            )}
            {errandForm.category === ErrandCategory.MAMA_FUA && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Baskets <span className="text-red-500">*</span></label>
                    <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200">
                      <button type="button" onClick={() => handleUpdate({ laundryBaskets: Math.max(1, (errandForm.laundryBaskets || 1) - 1) })} className="w-10 h-10 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all">-</button>
                      <span className="flex-1 text-center font-black text-sm">{errandForm.laundryBaskets || 1}</span>
                      <button type="button" onClick={() => handleUpdate({ laundryBaskets: (errandForm.laundryBaskets || 1) + 1 })} className="w-10 h-10 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all">+</button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Price / Basket</label>
                    <input type="number" value={errandForm.pricePerBasket || 250} onChange={e => handleUpdate({ pricePerBasket: parseInt(e.target.value) })} className="w-full p-4 brand-input rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <p className="text-xs font-black text-slate-900">In-House Cleaning?</p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Runner comes to your home</p>
                  </div>
                  <button type="button" onClick={() => handleUpdate({ isInHouse: !errandForm.isInHouse })} className={`w-12 h-6 rounded-full transition-all relative ${errandForm.isInHouse ? 'bg-indigo-600 shadow-lg shadow-indigo-100' : 'bg-slate-200'}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${errandForm.isInHouse ? 'left-7' : 'left-1'}`} /></button>
                </div>
                <div className="p-4 rounded-xl bg-indigo-600 text-white flex justify-between items-center shadow-lg shadow-indigo-100"><span className="text-[10px] font-black uppercase">Estimated Total</span><span className="text-sm font-black text-white">Ksh {totalMamaFuaCost}</span></div>
                <LocationAutocomplete label="Location" placeholder="Where should runner go?" icon={<MapPin size={10} />} onSelect={loc => handleUpdate({ pickup: loc })} value={errandForm.pickup?.name} required />
                {!errandForm.isInHouse && <LocationAutocomplete label="Delivery Location" placeholder="Where to deliver back?" icon={<MapPinned size={10} />} onSelect={loc => handleUpdate({ dropoff: loc })} value={errandForm.dropoff?.name} required />}
              </div>
            )}
          </div>
          <button type="submit" disabled={loading} className="w-full py-6 bg-indigo-600 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-indigo-100 active:scale-95 transition-all mt-4 flex items-center justify-center gap-3 hover:bg-indigo-700">{loading ? <LoadingSpinner color="white" /> : <><Zap size={18} fill="currentColor" />Broadcast Errand</>}</button>
        </form>
      </div>
    </div>
  );
};

const MenuView: React.FC<{ listings: ServiceListing[], onSelect: (listing: ServiceListing) => void }> = ({ listings, onSelect }) => {
  const [activeCategory, setActiveCategory] = useState<ErrandCategory | 'All'>('All');
  const [viewingListing, setViewingListing] = useState<ServiceListing | null>(null);
  
  const filtered = activeCategory === 'All' ? listings : listings.filter(l => l.category === activeCategory);
  
  const categories = ['All', ...Object.values(ErrandCategory)];

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xl font-black text-slate-900 tracking-tight">Service Menu</h2>
        <div className="p-2 bg-slate-100 rounded-xl">
          <Search size={16} className="text-slate-400" />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 px-2 no-scrollbar">
        {categories.map(cat => (
          <button 
            key={cat} 
            onClick={() => setActiveCategory(cat as any)}
            className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${activeCategory === cat ? 'bg-black text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-100'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="space-y-4 px-2">
        {filtered.length === 0 ? (
          <div className="p-20 text-center bg-white rounded-[2rem] border-2 border-dashed border-slate-100 text-slate-300 font-black uppercase text-[10px] tracking-widest">
            No services listed in this category
          </div>
        ) : (
          filtered.map(item => (
            <div 
              key={item.id} 
              onClick={() => setViewingListing(item)}
              className="bg-white rounded-[2rem] p-4 border border-slate-100 shadow-sm flex gap-4 items-center animate-in fade-in slide-in-from-bottom-2 cursor-pointer hover:border-indigo-100 transition-all"
            >
              <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 border border-slate-50">
                <img src={item.imageUrl} className="w-full h-full object-cover" alt={item.title} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start">
                  <h3 className="font-black text-slate-900 text-sm leading-tight">{item.title} {item.scope && <span className="text-slate-400 font-bold">({item.scope})</span>}</h3>
                  <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                    <Info size={12} />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 font-medium line-clamp-2 mt-1 leading-relaxed">{item.description}</p>
                <div className="flex justify-between items-center mt-3">
                  <p className="font-black text-slate-900 text-sm">KSh{item.price}</p>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item);
                    }}
                    className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {viewingListing && (
        <ServiceListingDetailModal 
          listing={viewingListing} 
          onClose={() => setViewingListing(null)} 
          onOrder={(l) => {
            onSelect(l);
            setViewingListing(null);
          }}
        />
      )}
    </div>
  );
};

const ServiceListingDetailModal: React.FC<{ listing: ServiceListing, onClose: () => void, onOrder: (l: ServiceListing) => void }> = ({ listing, onClose, onOrder }) => {
  const [explanation, setExplanation] = useState(listing.explanation || '');
  const [paymentGuide, setPaymentGuide] = useState(listing.paymentGuide || '');
  const [loading, setLoading] = useState(!listing.explanation || !listing.paymentGuide);

  useEffect(() => {
    if (!listing.explanation || !listing.paymentGuide) {
      const generateDetails = async () => {
        try {
          const prompt = `Generate a detailed explanation and a payment guide for a service listing in an on-demand errands app.
          Service Title: ${listing.title}
          Category: ${listing.category}
          Description: ${listing.description}
          Base Price: KSh ${listing.price}

          Return the response in JSON format with two fields: "explanation" (what the runner does) and "paymentGuide" (how the pricing works, including potential extra costs like transport).
          Make it professional and concise.`;
          
          const response = await callGeminiWithRetry(prompt);
          const cleaned = response.replace(/```json|```/g, '').trim();
          const data = JSON.parse(cleaned);
          setExplanation(data.explanation);
          setPaymentGuide(data.paymentGuide);
        } catch (e) {
          setExplanation(listing.description);
          setPaymentGuide(`Base price is KSh ${listing.price}. Additional costs may apply for distance or extra requirements.`);
        } finally {
          setLoading(false);
        }
      };
      generateDetails();
    }
  }, [listing]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
        <div className="relative h-56 flex-shrink-0">
          <img src={listing.imageUrl} className="w-full h-full object-cover" alt={listing.title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/40 transition-all z-10">
            <X size={20} />
          </button>
          <div className="absolute bottom-6 left-6 right-6">
            <span className="text-[9px] font-black uppercase tracking-widest text-white bg-indigo-600 px-3 py-1 rounded-full">{listing.category}</span>
            <h3 className="text-2xl font-[900] text-white mt-2 leading-tight">{listing.title}</h3>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
          <div className="space-y-2">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Task Explanation</h4>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-400 py-2">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Generating details...</span>
              </div>
            ) : (
              <p className="text-xs text-slate-600 font-medium leading-relaxed">{explanation}</p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Payment Guide</h4>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-400 py-2">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Calculating guide...</span>
              </div>
            ) : (
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <p className="text-xs text-slate-600 font-medium leading-relaxed mb-3">{paymentGuide}</p>
                <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                  <span className="text-[10px] font-black text-slate-400 uppercase">Base Price</span>
                  <span className="text-lg font-black text-slate-900">KSh {listing.price}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-100/50 flex items-start gap-3">
            <Info size={18} className="text-indigo-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-indigo-600/80 font-bold leading-relaxed">
              By ordering, you'll be matched with a verified runner. You only pay once the task is completed to your satisfaction.
            </p>
          </div>
        </div>

        <div className="p-6 bg-white border-t border-slate-50 flex-shrink-0">
          <button 
            onClick={() => onOrder(listing)}
            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <ShoppingBag size={18} /> Order Now
          </button>
        </div>
      </div>
    </div>
  );
};

const DashboardGuide: React.FC = () => {
  return (
    <div className="space-y-6 py-4">
      <div className="px-2">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Platform Guide</h3>
        <h2 className="text-xl font-black text-slate-900 tracking-tight mt-1">How it Works</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Section 1: What are tasks */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
            <Target size={24} />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">What are Tasks?</h4>
            <p className="text-[11px] text-slate-500 font-medium leading-relaxed mt-2">
              Tasks are on-demand services ranging from grocery shopping and laundry (Mama Fua) to specialized house hunting. We bridge the gap between your needs and reliable local assistance.
            </p>
          </div>
        </div>

        {/* Section 2: Posting Errands */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
            <PlusCircle size={24} />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Post an Errand</h4>
            <p className="text-[11px] text-slate-500 font-medium leading-relaxed mt-2">
              Need something done? Click "Post Errand", choose a category, set your budget, and describe the task. Local runners will see your request and send proposals instantly.
            </p>
          </div>
        </div>

        {/* Section 3: Accepting Errands */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
            <Zap size={24} />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Accept & Earn</h4>
            <p className="text-[11px] text-slate-500 font-medium leading-relaxed mt-2">
              As a runner, browse "Available Errands" on the map or list. Send your interest at the specified budget. Once assigned, complete the task, upload proof, and get paid securely.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-[2rem] p-8 text-white relative overflow-hidden">
        <div className="relative z-10 max-w-lg">
          <h3 className="text-lg font-black tracking-tight mb-2">Secure & Reliable</h3>
          <p className="text-xs text-slate-400 font-medium leading-relaxed">
            Every transaction is protected. Funds are held securely and only released when you sign off on the completed task. Our rating system ensures high-quality service for everyone.
          </p>
        </div>
        <ShieldAlert className="absolute -right-6 -bottom-6 text-white/5" size={140} />
      </div>
    </div>
  );
};

const SupportChatOverlay: React.FC<{ user: User }> = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [chat, setChat] = useState<any>(null);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const unsub = firebaseService.subscribeToSupportChat(user.id, (data) => {
        setChat(data);
        if (data?.unreadByUser) {
          firebaseService.markSupportChatAsRead(user.id, false);
        }
      });
      return () => unsub();
    }
  }, [isOpen, user.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat?.messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const msg = text;
    setText('');
    await firebaseService.sendSupportMessage(user.id, user.name, msg);
  };

  return (
    <div className="fixed bottom-24 right-6 z-[60] md:bottom-8">
      {isOpen ? (
        <div className="w-[320px] h-[450px] bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
          <header className="p-5 bg-black text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                <MessageCircle size={18} />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest">Support Chat</h3>
                <p className="text-[8px] font-bold opacity-60 uppercase">We're online</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
              <X size={18} />
            </button>
          </header>
          
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {!chat || !chat.messages || chat.messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                  <HelpCircle size={24} />
                </div>
                <div>
                  <p className="text-xs font-black text-slate-900 uppercase">How can we help?</p>
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-1">Send us a message and our team will get back to you shortly.</p>
                </div>
              </div>
            ) : (
              chat.messages.map((m: any, i: number) => (
                <div key={i} className={`flex flex-col ${m.senderId === user.id ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-[11px] font-medium leading-relaxed ${m.senderId === user.id ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white text-slate-900 border border-slate-100 rounded-tl-none shadow-sm'}`}>
                    {m.text}
                  </div>
                  <span className="text-[7px] font-black text-slate-400 uppercase mt-1 px-1">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSend} className="p-3 bg-white border-t flex gap-2">
            <input 
              type="text" value={text} onChange={e => setText(e.target.value)} 
              placeholder="Type your message..." 
              className="flex-1 bg-slate-50 border-none rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none focus:ring-2 focus:ring-black/5"
            />
            <button type="submit" className="p-2.5 bg-black text-white rounded-xl active:scale-90 transition-all shadow-lg">
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
      ) : (
        <button 
          onClick={() => setIsOpen(true)} 
          className="w-14 h-14 bg-black text-white rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-90 transition-all group relative"
        >
          <MessageCircle size={24} />
          {chat?.unreadByUser && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full" />
          )}
          <div className="absolute right-full mr-3 px-3 py-1.5 bg-black text-white text-[9px] font-black uppercase tracking-widest rounded-lg opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap">
            Chat with Support
          </div>
        </button>
      )}
    </div>
  );
};

export default function App() {
  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [errands, setErrands] = useState<Errand[]>([]);
  const [availableErrands, setAvailableErrands] = useState<Errand[]>([]);
  const [nearbyRunners, setNearbyRunners] = useState<User[]>([]);
  const [selectedErrand, setSelectedErrand] = useState<Errand | null>(null);
  const [isLogin, setIsLogin] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings>({ primaryColor: '#000000' });
  const [formErrors, setFormErrors] = useState<any>({});
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [stats, setStats] = useState({ totalUsers: 0, totalTasks: 0, onlineUsers: 0 });
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [profileView, setProfileView] = useState<'main' | 'edit' | 'history'>('main');
  const [proximityFilter, setProximityFilter] = useState<number | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showPriceGuideModal, setShowPriceGuideModal] = useState(false);
  const [showContactUsModal, setShowContactUsModal] = useState(false);
  const [featuredServices, setFeaturedServices] = useState<FeaturedService[]>([]);
  const [selectedFeaturedService, setSelectedFeaturedService] = useState<FeaturedService | null>(null);
  const [serviceListings, setServiceListings] = useState<ServiceListing[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const [errandForm, setErrandForm] = useState<any>({ category: ErrandCategory.GENERAL, title: '', budget: 0, deadline: '', pickup: null, dropoff: null, laundryBaskets: 1, pricePerBasket: 250, houseType: '', minBudget: 0, maxBudget: 0, moveInDate: '', additionalRequirements: '', description: '', isInHouse: false });
  const [authForm, setAuthForm] = useState({ name: '', email: '', phone: '', password: '', role: UserRole.REQUESTER });

  useEffect(() => {
    firebaseService.getCurrentUser().then(u => { 
      if (u) { 
        setUser(u); 
        setIsDarkMode(u.theme === 'dark');
      } 
      setLoading(false); 
    });
  }, []);

  useEffect(() => {
    const unsub = firebaseService.subscribeToSettings(setAppSettings);
    return () => unsub();
  }, [user?.id]);

  useEffect(() => {
    if (user?.isAdmin) {
      firebaseService.getAppStats().then(setStats);
    }
  }, [user?.id, user?.isAdmin]);

  useEffect(() => {
    firebaseService.fetchFeaturedServices().then(setFeaturedServices);
    firebaseService.fetchServiceListings().then(setServiceListings);
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(coords);
          if (user) {
            firebaseService.updateUserSettings(user.id, { lastKnownLocation: coords });
          }
        },
        (err) => console.error("Geolocation error:", err),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (!user) return;
    
    const unsubErrands = firebaseService.subscribeToUserErrands(user.id, user.role, (list) => {
      setErrands(list);
      if (selectedErrand) {
        const updated = list.find(e => e.id === selectedErrand.id);
        if (updated) setSelectedErrand(updated);
      }
    });

    const unsubNotifs = firebaseService.subscribeToNotifications(user.id, setNotifications);

    let unsubAvailable: any = null;
    if (user.role === UserRole.RUNNER) {
      unsubAvailable = firebaseService.subscribeToAvailableErrands(setAvailableErrands);
    } else {
      firebaseService.getNearbyRunners().then(setNearbyRunners);
    }

    return () => {
      unsubErrands();
      unsubNotifs();
      if (unsubAvailable) unsubAvailable();
    };
  }, [user, selectedErrand?.id]);

  const filteredErrands = useMemo(() => {
    if (!proximityFilter || !currentLocation) return availableErrands;
    return availableErrands.filter(e => {
      if (!e.pickupCoordinates) return false;
      const dist = calculateDistance(currentLocation, e.pickupCoordinates);
      return dist <= proximityFilter;
    });
  }, [availableErrands, proximityFilter, currentLocation]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setFormErrors({});
    try {
      const u = isLogin ? await firebaseService.login(authForm.email, authForm.password) : await firebaseService.register(authForm.name, authForm.email, authForm.phone, authForm.password);
      setUser(u);
      setIsDarkMode(u.theme === 'dark');
    } catch (err: any) { setFormErrors({ auth: formatFirebaseError(err) }); } finally { setIsProcessing(false); }
  };

  const toggleDarkMode = async () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (user) {
      await firebaseService.updateUserSettings(user.id, { theme: newMode ? 'dark' : 'light' });
    }
  };

  const validateForm = () => {
    if (!errandForm.title) return "Title is required";
    if (!errandForm.pickup) return "Location is required";
    if (errandForm.category === ErrandCategory.HOUSE_HUNTING && (!errandForm.minBudget || !errandForm.maxBudget || !errandForm.houseType)) return "Budget range and house type are required";
    if (errandForm.category === ErrandCategory.MAMA_FUA && !errandForm.isInHouse && !errandForm.dropoff) return "Delivery location is required for laundry pickup";
    if (errandForm.category === ErrandCategory.GENERAL && (!errandForm.budget || !errandForm.dropoff)) return "Budget and drop-off are required";
    return null;
  };

  const postErrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const error = validateForm();
    if (error) { alert(error); return; }
    setIsProcessing(true);
    try {
      let finalBudget = errandForm.budget;
      if (errandForm.category === ErrandCategory.MAMA_FUA) finalBudget = (errandForm.laundryBaskets || 1) * (errandForm.pricePerBasket || 250);
      else if (errandForm.category === ErrandCategory.HOUSE_HUNTING) finalBudget = errandForm.maxBudget;
      const data = { 
        ...errandForm, 
        budget: finalBudget, 
        requesterId: user.id, 
        requesterName: user.name, 
        pickupLocation: errandForm.pickup?.name || '', 
        pickupCoordinates: errandForm.pickup?.coords || { lat: 0, lng: 0 }, 
        dropoffLocation: errandForm.isInHouse ? (errandForm.pickup?.name || '') : (errandForm.dropoff?.name || errandForm.pickup?.name || ''), 
        dropoffCoordinates: errandForm.isInHouse ? (errandForm.pickup?.coords || { lat: 0, lng: 0 }) : (errandForm.dropoff?.coords || errandForm.pickup?.coords || { lat: 0, lng: 0 }) 
      };
      await firebaseService.createErrand(data);
      setErrandForm({ category: ErrandCategory.GENERAL, title: '', budget: 0, deadline: '', pickup: null, dropoff: null, laundryBaskets: 1, pricePerBasket: 250, houseType: '', minBudget: 0, maxBudget: 0, moveInDate: '', additionalRequirements: '', description: '', isInHouse: false });
      setActiveTab('dashboard');
    } catch (e) { alert("Post failed."); } finally { setIsProcessing(false); }
  };

  const handleRunnerComplete = async (id: string, comments: string, photo?: string) => {
    setIsProcessing(true);
    try {
      await firebaseService.submitForReview(id, comments, photo);
    } catch (e) { alert("Submission failed."); } finally { setIsProcessing(false); }
  };

  if (loading) return <div className="h-screen flex items-center justify-center"><LoadingSpinner size={40} color="#000000" /></div>;

  const protectedAction = (action: () => void) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    action();
  };

  return (
    <APIProvider apiKey={googleMapsApiKey || ''}>
      <Layout 
        user={user} 
      onLogout={() => firebaseService.logout().then(() => setUser(null))} 
      activeTab={activeTab} 
      setActiveTab={setActiveTab}
      onNotificationClick={(notif) => {
        if (notif.errandId) {
          const errand = errands.concat(availableErrands).find(e => e.id === notif.errandId);
          if (errand) {
            setSelectedErrand(errand);
          } else {
            // If not in current lists, try to fetch it
            firebaseService.fetchErrandById(notif.errandId).then(e => {
              if (e) setSelectedErrand(e);
            });
          }
        } else if (notif.type === 'message') {
          setActiveTab('my-errands');
        }
      }}
    >
      <TopProgressBar isLoading={isProcessing} />
      <div className="max-w-5xl mx-auto space-y-3 px-2">
        {activeTab === 'dashboard' && (
          <div className="space-y-5 pb-8">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-[2rem] p-6 text-white relative overflow-hidden shadow-xl shadow-indigo-100">
              <div className="relative z-10">
                <h2 className="text-xl font-black mb-0.5 tracking-tight">Hello, {user ? user.name.split(' ')[0] : 'Guest'}!</h2>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] opacity-80 mb-4">What can we do for you today?</p>
                {user?.isAdmin && (
                  <div className="grid grid-cols-3 gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div className="bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/5"><p className="text-[7px] font-black uppercase opacity-70 mb-0.5">Users</p><p className="text-sm font-black">{stats.totalUsers}</p></div>
                    <div className="bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/5"><p className="text-[7px] font-black uppercase opacity-70 mb-0.5">Tasks</p><p className="text-sm font-black">{stats.totalTasks}</p></div>
                    <div className="bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/5"><p className="text-[7px] font-black uppercase opacity-70 mb-0.5">Online</p><p className="text-sm font-black text-emerald-300">{stats.onlineUsers}</p></div>
                  </div>
                )}
              </div>
              <Sparkles className="absolute -right-4 -bottom-4 text-white/10" size={120} />
            </div>

            {/* Search Bar */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                <Search className="text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
              </div>
              <input 
                type="text" 
                placeholder="What do you need help with?" 
                className="w-full pl-12 pr-6 py-4 bg-white border border-slate-100 rounded-2xl font-bold text-slate-900 outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500/20 transition-all shadow-sm"
              />
            </div>

            {/* Categories */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-black text-slate-900 tracking-tight">Categories</h3>
                <button onClick={() => setActiveTab('menu')} className="text-[9px] font-black uppercase text-indigo-600 tracking-widest bg-indigo-50 px-3 py-1 rounded-full">Explore</button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                {Object.values(ErrandCategory).map((cat) => (
                  <button 
                    key={cat}
                    onClick={() => {
                      setErrandForm({ ...errandForm, category: cat });
                      setActiveTab('create');
                    }}
                    className="flex-shrink-0 w-24 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all text-center group"
                  >
                    <div className="w-12 h-12 bg-indigo-50 rounded-xl mx-auto mb-2 overflow-hidden group-hover:scale-110 transition-transform flex items-center justify-center">
                      <img src={`https://picsum.photos/seed/${cat}/100/100`} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={cat} />
                    </div>
                    <p className="text-[9px] font-black text-slate-700 uppercase leading-tight truncate">{cat}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Featured Services */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-black text-slate-900 tracking-tight">Featured Services</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {featuredServices.length === 0 ? (
                  <div className="col-span-full p-12 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100 text-slate-300 font-black uppercase text-[9px] tracking-widest">
                    No featured services yet
                  </div>
                ) : (
                  featuredServices.map(service => (
                    <div 
                      key={service.id} 
                      onClick={() => setSelectedFeaturedService(service)}
                      className="bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-xl hover:border-indigo-100 transition-all group cursor-pointer"
                    >
                      <div className="aspect-square relative overflow-hidden">
                        <img src={service.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={service.title} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                           <p className="text-[8px] font-black text-white uppercase tracking-widest">View Details</p>
                        </div>
                      </div>
                      <div className="p-3">
                        <h4 className="text-xs font-black text-slate-900 tracking-tight truncate mb-1">{service.title}</h4>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-black text-indigo-600">From KSH {service.price}</p>
                          <Plus size={12} className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-black text-slate-900 tracking-tight">Recent Activity</h3>
                <button onClick={() => setActiveTab('my-errands')} className="text-[9px] font-black uppercase text-indigo-600 tracking-widest bg-indigo-50 px-3 py-1 rounded-full">History</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {errands.slice(0, 4).length === 0 ? (
                  <div className="col-span-full p-10 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100 text-slate-300 font-black uppercase text-[9px] tracking-widest">No Recent Activity</div>
                ) : (
                  errands.slice(0, 4).map(e => <ErrandCard key={e.id} errand={e} onClick={setSelectedErrand} currentLocation={currentLocation} />)
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'my-errands' && (
          <div className="space-y-6">
            {!user ? (
              <div className="p-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                <ShieldAlert size={48} className="mx-auto mb-4 text-slate-200" />
                <h3 className="text-lg font-black text-slate-900 mb-2">Login Required</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Sign in to view your tasks</p>
                <button onClick={() => setShowAuthModal(true)} className="px-10 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl">Sign In Now</button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-2">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">My Errands</h2>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Manage your tasks</p>
                  </div>
                  <div className="bg-slate-100 px-3 py-1 rounded-full text-[10px] font-black text-slate-500 uppercase">{errands.length} Total</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {errands.length === 0 ? (
                    <div className="col-span-full p-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100 text-slate-300 font-black">
                      <List size={48} className="mx-auto mb-4 opacity-20" />
                      <p>No Errands Found</p>
                    </div>
                  ) : (
                    errands.map(e => <ErrandCard key={e.id} errand={e} onClick={setSelectedErrand} currentLocation={currentLocation} />)
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {activeTab === 'menu' && (
          <MenuView 
            listings={serviceListings} 
            onSelect={(listing) => {
              setSelectedFeaturedService(listing as any);
            }} 
          />
        )}
        {activeTab === 'create' && (
          <CreateScreen 
            errandForm={errandForm} 
            setErrandForm={setErrandForm} 
            postErrand={(e: any) => protectedAction(() => postErrand(e))} 
            loading={isProcessing} 
            errors={formErrors} 
          />
        )}
        {activeTab === 'find' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Find Errands</h2>
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-slate-400" />
                <select 
                  value={proximityFilter || ''} 
                  onChange={e => setProximityFilter(e.target.value ? parseInt(e.target.value) : null)}
                  className="bg-slate-100 border-none rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest outline-none"
                >
                  <option value="">All Distances</option>
                  <option value="5">Within 5km</option>
                  <option value="10">Within 10km</option>
                  <option value="20">Within 20km</option>
                  <option value="50">Within 50km</option>
                </select>
              </div>
            </div>
            <MapView errands={filteredErrands} onSelectErrand={setSelectedErrand} height="300px" userLocation={currentLocation} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredErrands.length === 0 ? (
                <div className="col-span-full p-20 text-center bg-white rounded-[2rem] border-2 border-dashed border-slate-100 text-slate-300 font-black">
                  No errands found in this range
                </div>
              ) : (
                filteredErrands.map(e => <ErrandCard key={e.id} errand={e} onClick={setSelectedErrand} currentLocation={currentLocation} />)
              )}
            </div>
          </div>
        )}
        {activeTab === 'admin' && user && <AdminPanel user={user} settings={appSettings} stats={stats} />}
        {activeTab === 'active' && (
           <div className="max-w-xl mx-auto pb-10 -mt-2 md:-mt-4">
            {!user ? (
              <div className="bg-white rounded-[2.5rem] p-12 border border-slate-100 shadow-sm text-center animate-in fade-in zoom-in-95">
                <div className="w-24 h-24 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 relative overflow-hidden">
                   <div className="absolute inset-0 bg-gradient-to-tr from-slate-100 to-transparent opacity-50" />
                   <UserCircle size={48} className="text-slate-200 relative z-10" />
                </div>
                <h2 className="text-2xl font-black text-slate-900 mb-2">My Profile</h2>
                <p className="text-sm font-bold text-slate-400 mb-10">Login to see your info</p>
                <button onClick={() => setShowAuthModal(true)} className="w-full py-5 bg-[#00aeef] text-white rounded-[2rem] font-black uppercase text-sm tracking-widest shadow-xl active:scale-95 transition-all">Login</button>
                
                <div className="mt-12 space-y-1">
                  <ProfileMenuItem icon={<Globe size={18} />} label="Change Language" onClick={() => setShowLanguageModal(true)} />
                  <ProfileMenuItem icon={<Calculator size={18} />} label="Price Guide" onClick={() => setShowPriceGuideModal(true)} />
                  <ProfileMenuItem icon={<HelpCircle size={18} />} label="FAQs" />
                  <ProfileMenuItem icon={<Phone size={18} />} label="Contact Us" onClick={() => setShowContactUsModal(true)} />
                  <ProfileMenuItem icon={<ShieldAlert size={18} />} label="Cookies Policy" />
                  <ProfileMenuItem icon={<Info size={18} />} label="About Us" />
                  <ProfileMenuItem icon={<ShieldAlert size={18} />} label="Privacy Policy" />
                  <ProfileMenuItem icon={<List size={18} />} label="Terms and Conditions" />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {profileView === 'main' && (
                  <>
                    <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm text-center">
                      <img src={user.avatar || `https://i.pravatar.cc/150?u=${user.id}`} className="w-20 h-20 rounded-[1.5rem] mx-auto mb-5 border-4 border-white shadow-xl" />
                      <h2 className="text-lg font-black text-slate-900">{user.name}</h2>
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1 mb-4">{user.role}</p>
                      
                      {user.biography && (
                        <p className="text-xs text-slate-500 font-medium mb-6 px-4 leading-relaxed italic">"{user.biography}"</p>
                      )}

                      <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="bg-slate-50 p-4 rounded-2xl"><p className="text-[8px] font-black uppercase text-slate-400">Rating</p><p className="text-lg font-black text-slate-900">{user.rating.toFixed(1)}</p></div>
                        <div className="bg-slate-50 p-4 rounded-2xl"><p className="text-[8px] font-black uppercase text-slate-400">Balance</p><p className="text-lg font-black text-emerald-600">Ksh {user.balanceOnHold || 0}</p></div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setProfileView('edit')} className="py-3.5 bg-black text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:opacity-90 transition-all">Edit Profile</button>
                        <button onClick={() => setProfileView('history')} className="py-3.5 border border-slate-200 text-slate-600 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 transition-all">Task History</button>
                      </div>

                      {user.role === UserRole.REQUESTER && (
                        <button onClick={() => setProfileView('apply-runner')} className="w-full mt-3 py-4 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
                          <Briefcase size={16} /> Become a Runner
                        </button>
                      )}

                      <button onClick={() => firebaseService.logout().then(() => setUser(null))} className="w-full mt-3 py-3.5 border border-red-100 text-red-500 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-red-50 transition-all">Sign Out</button>
                    </div>

                    <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="p-3 bg-black text-white rounded-xl"><Settings size={20} /></div>
                        <div><h3 className="text-base font-black text-slate-900">Settings</h3><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Preferences</p></div>
                      </div>
                      <UserSettings user={user} isDarkMode={isDarkMode} onToggleDarkMode={toggleDarkMode} />
                    </div>

                    <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="p-3 bg-indigo-600 text-white rounded-xl"><HelpCircle size={20} /></div>
                          <div><h3 className="text-base font-black text-slate-900">Support</h3><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Get Help</p></div>
                        </div>
                        <button onClick={() => setShowContactUsModal(true)} className="text-[9px] font-black uppercase text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">Contact Us</button>
                      </div>
                      <div className="space-y-1">
                        <ProfileMenuItem icon={<Globe size={18} />} label="Change Language" onClick={() => setShowLanguageModal(true)} />
                        <ProfileMenuItem icon={<Calculator size={18} />} label="Price Guide" onClick={() => setShowPriceGuideModal(true)} />
                        <ProfileMenuItem icon={<MessageCircle size={18} />} label="Live Support Chat" onClick={() => setActiveTab('support-chat')} />
                      </div>
                    </div>
                  </>
                )}

                {profileView === 'edit' && (
                  <ProfileEditor 
                    user={user} 
                    onUpdate={(updates) => setUser({...user, ...updates})} 
                    onBack={() => setProfileView('main')} 
                  />
                )}

                {profileView === 'apply-runner' && (
                  <RunnerApplicationFlow user={user} onBack={() => setProfileView('main')} />
                )}

                {profileView === 'history' && (
                  <TaskHistory 
                    user={user} 
                    onBack={() => setProfileView('main')} 
                    onSelectErrand={(e) => {
                      setSelectedErrand(e);
                      setProfileView('main');
                    }}
                  />
                )}
              </div>
            )}
           </div>
        )}
        {activeTab === 'support-chat' && user && (
          <div className="max-w-xl mx-auto h-[600px] bg-white rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col overflow-hidden">
            <header className="p-6 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveTab('active')} className="p-2 bg-slate-50 text-slate-400 rounded-xl"><ChevronLeft size={18} /></button>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Support Center</h3>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Live with Admin</p>
                </div>
              </div>
            </header>
            <SupportChatView user={user} />
          </div>
        )}
      </div>
      {selectedErrand && <ErrandDetailScreen selectedErrand={selectedErrand} setSelectedErrand={setSelectedErrand} user={user} onRunnerComplete={handleRunnerComplete} loading={isProcessing} />}
      {selectedFeaturedService && (
        <FeaturedServiceModal 
          service={selectedFeaturedService} 
          onClose={() => setSelectedFeaturedService(null)} 
          onOrder={(s) => {
            setErrandForm({ ...errandForm, category: s.category, title: s.title, description: s.description });
            setActiveTab('create');
            setSelectedFeaturedService(null);
          }}
        />
      )}
      {showLanguageModal && <LanguageModal onClose={() => setShowLanguageModal(false)} />}
      {showPriceGuideModal && <PriceGuideModal onClose={() => setShowPriceGuideModal(false)} />}
      {showContactUsModal && <ContactUsModal onClose={() => setShowContactUsModal(false)} setActiveTab={setActiveTab} />}
      {user && !user.isAdmin && <SupportChatOverlay user={user} />}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
        onAuthSuccess={(u) => setUser(u)} 
        firebaseService={firebaseService} 
      />
    </Layout>
  </APIProvider>
  );
}

const AuthScreen: React.FC<any> = ({ appSettings, isLogin, setIsLogin, authForm, setAuthForm, handleAuth, loading, error }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 font-sans">
    <div className="w-full max-w-md flex flex-col items-center">
      <div className="text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="w-24 h-24 bg-indigo-600 rounded-[2rem] flex items-center justify-center mx-auto mb-6 logo-shadow overflow-hidden shadow-xl shadow-indigo-100">
          {appSettings.logoUrl ? <img src={appSettings.logoUrl} className="w-full h-full object-cover" alt="Logo" /> : <ShoppingBag className="text-white" size={38} />}
        </div>
        <h1 className="text-4xl font-[900] text-slate-900 tracking-tight leading-none mb-3">Errands</h1>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.45em] ml-1">On Demand Excellence</p>
      </div>
      <div className="w-full bg-white rounded-[3rem] p-8 border border-slate-100 brand-shadow animate-in zoom-in-95 duration-500">
        <div className="text-center mb-8">
          <h2 className="text-xl font-[900] text-slate-900 tracking-tight mb-1.5">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{isLogin ? 'Sign in to your account' : 'Join our community today'}</p>
        </div>
        {error && <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-[10px] font-black mb-6 border border-red-100/50 uppercase text-center tracking-widest animate-shake">{error}</div>}
        <form onSubmit={handleAuth} className="space-y-6">
          {!isLogin && (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Full Name <span className="text-red-500">*</span></label>
                <input type="text" placeholder="John Doe" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} className="w-full p-4 brand-input rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20" required />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Phone Number <span className="text-red-500">*</span></label>
                <input type="tel" placeholder="+254..." value={authForm.phone} onChange={e => setAuthForm({...authForm, phone: e.target.value})} className="w-full p-4 brand-input rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20" required />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Email <span className="text-red-500">*</span></label>
            <input type="email" placeholder="email@example.com" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} className="w-full p-4 brand-input rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20" required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Password <span className="text-red-500">*</span></label>
            <input type="password" placeholder="••••••••" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} className="w-full p-4 brand-input rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500/20" required />
          </div>
          <button disabled={loading} className="w-full py-6 bg-indigo-600 text-white rounded-2xl font-[900] text-[12px] uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 mt-4 hover:bg-indigo-700 active:scale-95 transition-all">
            {loading ? <LoadingSpinner color="white" /> : (isLogin ? 'SIGN IN' : 'REGISTER')}
          </button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-8 text-[11px] font-black text-slate-500 uppercase tracking-widest hover:text-indigo-600 transition-all">{isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}</button>
      </div>
    </div>
  </div>
);

const FeaturedServiceModal: React.FC<{ service: FeaturedService, onClose: () => void, onOrder: (s: FeaturedService) => void }> = ({ service, onClose, onOrder }) => {
  const [explanation, setExplanation] = useState(service.explanation || '');
  const [paymentGuide, setPaymentGuide] = useState(service.paymentGuide || '');
  const [loading, setLoading] = useState(!service.explanation || !service.paymentGuide);

  useEffect(() => {
    if (!service.explanation || !service.paymentGuide) {
      const generateDetails = async () => {
        try {
          const prompt = `Generate a detailed explanation and a payment guide for a featured service in an on-demand errands app.
          Service Title: ${service.title}
          Category: ${service.category}
          Description: ${service.description}
          Base Price: KSh ${service.price}

          Return the response in JSON format with two fields: "explanation" (what the runner does) and "paymentGuide" (how the pricing works, including potential extra costs like transport).
          Make it professional and concise.`;
          
          const response = await callGeminiWithRetry(prompt);
          const cleaned = response.replace(/```json|```/g, '').trim();
          const data = JSON.parse(cleaned);
          setExplanation(data.explanation);
          setPaymentGuide(data.paymentGuide);
        } catch (e) {
          setExplanation(service.description);
          setPaymentGuide(`Base price is KSh ${service.price}. Additional costs may apply for distance or extra requirements.`);
        } finally {
          setLoading(false);
        }
      };
      generateDetails();
    }
  }, [service]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
        <div className="relative h-56 flex-shrink-0">
          <img src={service.imageUrl} className="w-full h-full object-cover" alt={service.title} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/40 transition-all z-10">
            <X size={20} />
          </button>
          <div className="absolute bottom-6 left-6 right-6">
            <span className="text-[9px] font-black uppercase tracking-widest text-white bg-indigo-600 px-3 py-1 rounded-full">{service.category}</span>
            <h3 className="text-2xl font-[900] text-white mt-2 leading-tight">{service.title}</h3>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
          <div className="space-y-2">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Task Explanation</h4>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-400 py-2">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Generating details...</span>
              </div>
            ) : (
              <p className="text-xs text-slate-600 font-medium leading-relaxed">{explanation}</p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Payment Guide</h4>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-400 py-2">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Calculating guide...</span>
              </div>
            ) : (
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <p className="text-xs text-slate-600 font-medium leading-relaxed mb-3">{paymentGuide}</p>
                <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                  <span className="text-[10px] font-black text-slate-400 uppercase">Base Price</span>
                  <span className="text-lg font-black text-slate-900">KSh {service.price}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-100/50 flex items-start gap-3">
            <Info size={18} className="text-indigo-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-indigo-600/80 font-bold leading-relaxed">
              This is a featured service. Our top-rated runners are prioritized for these tasks to ensure the best experience.
            </p>
          </div>
        </div>

        <div className="p-6 bg-white border-t border-slate-50 flex-shrink-0">
          <button 
            onClick={() => onOrder(service)}
            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-indigo-100 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <ShoppingBag size={18} /> Order Service
          </button>
        </div>
      </div>
    </div>
  );
};

const LanguageModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
    <div className="bg-white rounded-[2rem] w-full max-w-xs overflow-hidden shadow-2xl animate-in zoom-in-95">
      <div className="p-6 border-b flex justify-between items-center">
        <h3 className="text-sm font-black uppercase tracking-widest">Select Language</h3>
        <button onClick={onClose} className="p-2 bg-slate-50 rounded-xl"><X size={16} /></button>
      </div>
      <div className="p-2">
        <button className="w-full flex items-center justify-between p-4 bg-indigo-50 text-indigo-600 rounded-xl font-black text-xs uppercase tracking-widest">
          English <Check size={16} />
        </button>
        <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 text-slate-400 rounded-xl font-black text-xs uppercase tracking-widest">
          Swahili <span>(Coming Soon)</span>
        </button>
        <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 text-slate-400 rounded-xl font-black text-xs uppercase tracking-widest">
          French <span>(Coming Soon)</span>
        </button>
      </div>
    </div>
  </div>
);

const PriceGuideModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
    <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 max-h-[80vh] flex flex-col">
      <div className="p-6 border-b flex justify-between items-center bg-slate-50">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest">Pricing Guide</h3>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Estimated Base Rates</p>
        </div>
        <button onClick={onClose} className="p-2 bg-white rounded-xl shadow-sm"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {[
          { category: 'Laundry (Mama Fua)', price: 'Ksh 250', unit: 'per basket' },
          { category: 'House Hunting', price: 'Ksh 1,500', unit: 'per day' },
          { category: 'Grocery Shopping', price: 'Ksh 300', unit: 'per trip' },
          { category: 'Parcel Delivery', price: 'Ksh 200', unit: 'per 5km' },
          { category: 'Cleaning Services', price: 'Ksh 800', unit: 'per room' },
          { category: 'Pet Walking', price: 'Ksh 400', unit: 'per hour' },
          { category: 'General Errands', price: 'Ksh 500', unit: 'base rate' }
        ].map((item, idx) => (
          <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div>
              <p className="text-xs font-black text-slate-900">{item.category}</p>
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{item.unit}</p>
            </div>
            <p className="text-sm font-black text-indigo-600">From {item.price}</p>
          </div>
        ))}
        <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
          <p className="text-[9px] font-bold text-indigo-600 leading-relaxed italic">
            * Prices are estimates and may vary based on urgency, distance, and specific requirements. Runners may bid higher or lower than these rates.
          </p>
        </div>
      </div>
    </div>
  </div>
);

const ContactUsModal: React.FC<{ onClose: () => void, setActiveTab: (t: string) => void }> = ({ onClose, setActiveTab }) => (
  <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
    <div className="bg-white rounded-[2.5rem] w-full max-w-xs overflow-hidden shadow-2xl animate-in zoom-in-95">
      <div className="p-6 border-b flex justify-between items-center">
        <h3 className="text-sm font-black uppercase tracking-widest">Contact Us</h3>
        <button onClick={onClose} className="p-2 bg-slate-50 rounded-xl"><X size={16} /></button>
      </div>
      <div className="p-2">
        <ProfileMenuItem icon={<MessageCircle size={18} />} label="Live Support Chat" onClick={() => { setActiveTab('support-chat'); onClose(); }} />
        <ProfileMenuItem icon={<Mail size={18} />} label="Email Support" onClick={() => window.location.href = "mailto:errand.support@codexict.co.ke"} />
        <ProfileMenuItem icon={<MessageCircle size={18} className="text-emerald-500" />} label="WhatsApp" onClick={() => window.open("https://wa.me/254722603149", "_blank")} />
        <ProfileMenuItem icon={<Phone size={18} className="text-indigo-500" />} label="Call Support" onClick={() => window.location.href = "tel:+254752269300"} />
      </div>
    </div>
  </div>
);

const ProfileMenuItem: React.FC<{ icon: React.ReactNode, label: string, onClick?: () => void }> = ({ icon, label, onClick }) => (
  <button onClick={onClick} className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-all border-b border-slate-50 last:border-none group">
    <div className="flex items-center gap-4">
      <div className="text-slate-400 group-hover:text-black transition-colors">{icon}</div>
      <span className="text-sm font-black text-slate-700 tracking-tight">{label}</span>
    </div>
    <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
  </button>
);

const AdminPanel: React.FC<{ user: User; settings: AppSettings; stats: { totalUsers: number, totalTasks: number, onlineUsers: number } }> = ({ user, settings, stats }) => {
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || '');
  const [iconUrl, setIconUrl] = useState(settings.iconUrl || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isIconUploading, setIsIconUploading] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<'stats' | 'branding' | 'support' | 'applications' | 'services' | 'listings' | 'users'>('stats');
  const [dbUsers, setDbUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [supportChats, setSupportChats] = useState<any[]>([]);
  const [applications, setApplications] = useState<RunnerApplication[]>([]);
  const [adminFeaturedServices, setAdminFeaturedServices] = useState<FeaturedService[]>([]);
  const [adminServiceListings, setAdminServiceListings] = useState<ServiceListing[]>([]);
  const [newService, setNewService] = useState({ title: '', description: '', price: 0, imageUrl: '', category: ErrandCategory.GENERAL });
  const [newListing, setNewListing] = useState({ title: '', description: '', price: 0, imageUrl: '', category: ErrandCategory.GENERAL, scope: '' });
  const [isAddingService, setIsAddingService] = useState(false);
  const [isAddingListing, setIsAddingListing] = useState(false);
  const [selectedSupportUser, setSelectedSupportUser] = useState<string | null>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = user.email === 'admin@codexict.co.ke';

  useEffect(() => {
    setPrimaryColor(settings.primaryColor);
    setLogoUrl(settings.logoUrl || '');
    setIconUrl(settings.iconUrl || '');
  }, [settings]);

  useEffect(() => {
    if (activeAdminTab === 'support') {
      const unsub = firebaseService.subscribeToAllSupportChats(setSupportChats);
      return () => unsub();
    }
    if (activeAdminTab === 'applications') {
      firebaseService.fetchRunnerApplications().then(setApplications);
    }
    if (activeAdminTab === 'services') {
      firebaseService.fetchFeaturedServices().then(setAdminFeaturedServices);
    }
    if (activeAdminTab === 'listings') {
      firebaseService.fetchServiceListings().then(setAdminServiceListings);
    }
    if (activeAdminTab === 'users') {
      firebaseService.fetchAllUsers().then(setDbUsers);
    }
  }, [activeAdminTab]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const url = await cloudinaryService.uploadImage(file, 'app_logos');
      setLogoUrl(url);
      await firebaseService.saveAppSettings({ logoUrl: url });
      alert("Logo uploaded and updated.");
    } catch (e) { alert("Logo upload failed."); } finally { setIsUploading(false); }
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsIconUploading(true);
    try {
      const url = await cloudinaryService.uploadImage(file, 'app_icons');
      setIconUrl(url);
      await firebaseService.saveAppSettings({ iconUrl: url });
      alert("Icon uploaded and updated.");
    } catch (e) { alert("Icon upload failed."); } finally { setIsIconUploading(false); }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await firebaseService.saveAppSettings({ primaryColor, logoUrl, iconUrl });
      alert("Settings updated globally.");
    } catch (e) { alert("Failed to save settings."); } finally { setIsSaving(false); }
  };

  const handleApprove = async (app: RunnerApplication) => {
    try {
      await firebaseService.updateRunnerApplicationStatus(app.id, app.userId, 'approved', app.categoryApplied);
      setApplications(prev => prev.map(a => a.id === app.id ? {...a, status: 'approved'} : a));
      alert("Application approved!");
    } catch (e) { alert("Action failed"); }
  };

  const handleAddService = async () => {
    if (!newService.title || !newService.imageUrl) return;
    setIsAddingService(true);
    try {
      await firebaseService.addFeaturedService(newService);
      const updated = await firebaseService.fetchFeaturedServices();
      setAdminFeaturedServices(updated);
      setNewService({ title: '', description: '', price: 0, imageUrl: '', category: ErrandCategory.GENERAL });
      alert("Service added!");
    } catch (e) { alert("Failed to add service"); } finally { setIsAddingService(false); }
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm("Delete this service?")) return;
    try {
      await firebaseService.deleteFeaturedService(id);
      setAdminFeaturedServices(prev => prev.filter(s => s.id !== id));
    } catch (e) { alert("Delete failed"); }
  };

  const handleServiceImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const url = await cloudinaryService.uploadImage(file);
      setNewService({ ...newService, imageUrl: url });
    } catch (e) { alert("Image upload failed"); } finally { setIsUploading(false); }
  };

  const handleListingImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const url = await cloudinaryService.uploadImage(file);
      setNewListing({ ...newListing, imageUrl: url });
    } catch (e) { alert("Image upload failed"); } finally { setIsUploading(false); }
  };

  const handleAddListing = async () => {
    if (!newListing.title || !newListing.imageUrl) return;
    setIsAddingListing(true);
    try {
      await firebaseService.addServiceListing(newListing);
      const updated = await firebaseService.fetchServiceListings();
      setAdminServiceListings(updated);
      setNewListing({ title: '', description: '', price: 0, imageUrl: '', category: ErrandCategory.GENERAL, scope: '' });
      alert("Listing added!");
    } catch (e) { alert("Failed to add listing"); } finally { setIsAddingListing(false); }
  };

  const handleDeleteListing = async (id: string) => {
    if (!confirm("Delete this listing?")) return;
    try {
      await firebaseService.deleteServiceListing(id);
      setAdminServiceListings(prev => prev.filter(s => s.id !== id));
    } catch (e) { alert("Delete failed"); }
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit mb-4 overflow-x-auto max-w-full">
        <button onClick={() => setActiveAdminTab('stats')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'stats' ? 'bg-white text-black shadow-sm' : 'text-slate-400'}`}>Stats</button>
        <button onClick={() => setActiveAdminTab('applications')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'applications' ? 'bg-white text-black shadow-sm' : 'text-slate-400'}`}>Applications</button>
        <button onClick={() => setActiveAdminTab('listings')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'listings' ? 'bg-white text-black shadow-sm' : 'text-slate-400'}`}>Menu Listings</button>
        <button onClick={() => setActiveAdminTab('users')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'users' ? 'bg-white text-black shadow-sm' : 'text-slate-400'}`}>Users</button>
        <button onClick={() => setActiveAdminTab('services')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'services' ? 'bg-white text-black shadow-sm' : 'text-slate-400'}`}>Featured</button>
        {isSuperAdmin && <button onClick={() => setActiveAdminTab('branding')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'branding' ? 'bg-white text-black shadow-sm' : 'text-slate-400'}`}>Branding</button>}
        <button onClick={() => setActiveAdminTab('support')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeAdminTab === 'support' ? 'bg-white text-black shadow-sm' : 'text-slate-400'} flex items-center gap-2`}>
          Support
          {supportChats.some(c => c.unreadByAdmin) && <span className="w-2 h-2 bg-red-500 rounded-full" />}
        </button>
      </div>

      {activeAdminTab === 'stats' && (
        <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm space-y-6 animate-in fade-in">
          <div className="flex items-center gap-3"><div className="p-3 bg-black text-white rounded-xl"><ShieldAlert size={24} /></div><div><h2 className="text-lg font-black text-slate-900">Admin Panel</h2><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">System Overview</p></div></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 bg-slate-50 rounded-2xl text-center"><p className="text-[8px] font-black uppercase text-slate-400">Users</p><p className="text-base font-black text-slate-900">{stats.totalUsers}</p></div>
            <div className="p-4 bg-slate-50 rounded-2xl text-center"><p className="text-[8px] font-black uppercase text-slate-400">Tasks</p><p className="text-base font-black text-black">{stats.totalTasks}</p></div>
            <div className="p-4 bg-slate-50 rounded-2xl text-center"><p className="text-[8px] font-black uppercase text-slate-400">Online</p><p className="text-base font-black text-emerald-600">{stats.onlineUsers}</p></div>
          </div>
        </div>
      )}

      {activeAdminTab === 'applications' && (
        <div className="space-y-4 animate-in fade-in">
          {applications.length === 0 ? (
            <div className="p-20 text-center bg-white rounded-[2rem] border-2 border-dashed border-slate-100 text-slate-300 font-black uppercase text-[10px] tracking-widest">No applications yet</div>
          ) : (
            applications.map(app => (
              <div key={app.id} className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-black text-slate-900">{app.fullName}</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{app.categoryApplied} • {app.phone}</p>
                  </div>
                  <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg border ${app.status === 'pending' ? 'bg-amber-50 text-amber-600 border-amber-100' : app.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                    {app.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <img src={app.idFrontUrl} className="rounded-xl aspect-video object-cover border" alt="ID Front" />
                  <img src={app.idBackUrl} className="rounded-xl aspect-video object-cover border" alt="ID Back" />
                </div>
                {app.status === 'pending' ? (
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => firebaseService.updateRunnerApplicationStatus(app.id, app.userId, 'rejected').then(() => setActiveAdminTab('applications'))} className="flex-1 py-2.5 border border-red-100 text-red-500 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-red-50 transition-all">Reject</button>
                    <button onClick={() => handleApprove(app)} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all">Approve</button>
                  </div>
                ) : (
                  <div className="flex gap-2 pt-2">
                    <button 
                      onClick={() => firebaseService.updateRunnerApplicationStatus(app.id, app.userId, app.status === 'approved' ? 'rejected' : 'approved', app.categoryApplied).then(() => setActiveAdminTab('applications'))} 
                      className={`flex-1 py-2.5 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${app.status === 'approved' ? 'border border-red-100 text-red-500 hover:bg-red-50' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100'}`}
                    >
                      {app.status === 'approved' ? 'Revoke / Reject' : 'Re-Approve'}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeAdminTab === 'users' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">User Management</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{dbUsers.length} Total Users</p>
          </div>
          
          <div className="grid grid-cols-1 gap-3">
            {dbUsers.map(u => (
              <div key={u.id} className="bg-white rounded-[2rem] p-5 border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img src={u.avatar || `https://i.pravatar.cc/150?u=${u.id}`} className="w-12 h-12 rounded-2xl object-cover border-2 border-slate-50" alt="" />
                    <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${u.isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 text-sm">{u.name}</h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{u.email} • {u.phone || 'No Phone'}</p>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-md ${u.isAdmin ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>{u.isAdmin ? 'Admin' : u.role}</span>
                      {u.isVerified && <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-600">Verified</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setEditingUser(u)}
                    className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-slate-100 transition-all"
                  >
                    Edit User
                  </button>
                  {isSuperAdmin && !u.isAdmin && (
                    <button 
                      onClick={() => {
                        if(confirm(`Make ${u.name} an Admin?`)) {
                          firebaseService.adminUpdateUser(u.id, { isAdmin: true }).then(() => firebaseService.fetchAllUsers().then(setDbUsers));
                        }
                      }}
                      className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-indigo-100 transition-all"
                    >
                      Make Admin
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {editingUser && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95">
                <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                  <h3 className="text-sm font-black uppercase tracking-widest">Edit User: {editingUser.name}</h3>
                  <button onClick={() => setEditingUser(null)} className="p-2 bg-white rounded-xl shadow-sm"><X size={16} /></button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Role</label>
                    <select 
                      value={editingUser.role} 
                      onChange={e => setEditingUser({...editingUser, role: e.target.value as UserRole})}
                      className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
                    >
                      {Object.values(UserRole).map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Verification Status</label>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setEditingUser({...editingUser, isVerified: true})}
                        className={`flex-1 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${editingUser.isVerified ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' : 'bg-slate-50 text-slate-400'}`}
                      >
                        Verified
                      </button>
                      <button 
                        onClick={() => setEditingUser({...editingUser, isVerified: false})}
                        className={`flex-1 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${!editingUser.isVerified ? 'bg-red-600 text-white shadow-lg shadow-red-100' : 'bg-slate-50 text-slate-400'}`}
                      >
                        Unverified
                      </button>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      await firebaseService.adminUpdateUser(editingUser.id, { role: editingUser.role, isVerified: editingUser.isVerified });
                      const updated = await firebaseService.fetchAllUsers();
                      setDbUsers(updated);
                      setEditingUser(null);
                      alert("User updated successfully!");
                    }}
                    className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl mt-4"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeAdminTab === 'listings' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Add Menu Listing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input 
                type="text" 
                placeholder="Listing Title (e.g. Duvet Washing)" 
                value={newListing.title} 
                onChange={e => setNewListing({...newListing, title: e.target.value})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              />
              <input 
                type="text" 
                placeholder="Scope (e.g. Hand Wash, Per Hour)" 
                value={newListing.scope} 
                onChange={e => setNewListing({...newListing, scope: e.target.value})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              />
              <input 
                type="number" 
                placeholder="Price (KSH)" 
                value={newListing.price || ''} 
                onChange={e => setNewListing({...newListing, price: Number(e.target.value)})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              />
              <select 
                value={newListing.category} 
                onChange={e => setNewListing({...newListing, category: e.target.value as ErrandCategory})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              >
                {Object.values(ErrandCategory).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => document.getElementById('listing-img')?.click()}
                  className="flex-1 p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-bold text-xs flex items-center justify-center gap-2"
                >
                  {newListing.imageUrl ? <Check size={14} className="text-emerald-500" /> : <Upload size={14} />}
                  {newListing.imageUrl ? "Image Ready" : "Upload Image"}
                </button>
                <input id="listing-img" type="file" className="hidden" accept="image/*" onChange={handleListingImageUpload} />
              </div>
            </div>
            <textarea 
              placeholder="Description" 
              value={newListing.description} 
              onChange={e => setNewListing({...newListing, description: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm h-24 resize-none"
            />
            <button 
              disabled={isAddingListing || !newListing.title || !newListing.imageUrl}
              onClick={handleAddListing}
              className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl disabled:opacity-50"
            >
              {isAddingListing ? <LoadingSpinner color="white" /> : "Add Menu Listing"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {adminServiceListings.map(s => (
              <div key={s.id} className="bg-white rounded-[2rem] p-4 border border-slate-100 shadow-sm flex gap-4 items-center">
                <img src={s.imageUrl} className="w-16 h-16 rounded-xl object-cover border" alt="" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-slate-900 text-xs truncate">{s.title}</h4>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.category} • KSh{s.price}</p>
                </div>
                <button onClick={() => handleDeleteListing(s.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeAdminTab === 'services' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Add Featured Service</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input 
                type="text" 
                placeholder="Service Title" 
                value={newService.title} 
                onChange={e => setNewService({...newService, title: e.target.value})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              />
              <input 
                type="number" 
                placeholder="Price (KSH)" 
                value={newService.price || ''} 
                onChange={e => setNewService({...newService, price: Number(e.target.value)})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              />
              <select 
                value={newService.category} 
                onChange={e => setNewService({...newService, category: e.target.value as ErrandCategory})}
                className="p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm"
              >
                {Object.values(ErrandCategory).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => document.getElementById('service-img')?.click()}
                  className="flex-1 p-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-bold text-xs flex items-center justify-center gap-2"
                >
                  {newService.imageUrl ? <Check size={14} className="text-emerald-500" /> : <Upload size={14} />}
                  {newService.imageUrl ? "Image Ready" : "Upload Image"}
                </button>
                <input id="service-img" type="file" className="hidden" accept="image/*" onChange={handleServiceImageUpload} />
              </div>
            </div>
            <textarea 
              placeholder="Description" 
              value={newService.description} 
              onChange={e => setNewService({...newService, description: e.target.value})}
              className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm h-24 resize-none"
            />
            <button 
              disabled={isAddingService || !newService.title || !newService.imageUrl}
              onClick={handleAddService}
              className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl disabled:opacity-50"
            >
              {isAddingService ? <LoadingSpinner color="white" /> : "Add Featured Service"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {adminFeaturedServices.map(s => (
              <div key={s.id} className="bg-white rounded-[2rem] p-4 border border-slate-100 shadow-sm flex gap-4 items-center">
                <img src={s.imageUrl} className="w-20 h-20 rounded-2xl object-cover" alt={s.title} />
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-slate-900 truncate">{s.title}</h4>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.category} • KSH {s.price}</p>
                </div>
                <button onClick={() => handleDeleteService(s.id)} className="p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-all">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {activeAdminTab === 'branding' && isSuperAdmin && (
        <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm space-y-6 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-3"><div className="p-3 bg-black text-white rounded-xl"><Settings size={24} /></div><div><h2 className="text-lg font-black text-slate-900">Branding</h2><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Global Styles</p></div></div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Primary Color</label>
              <div className="flex gap-3">
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-12 h-12 rounded-xl cursor-pointer" />
                <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="flex-1 p-3 brand-input rounded-xl font-bold text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">App Logo</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-indigo-600 rounded-xl border-2 border-dashed border-indigo-200 flex items-center justify-center overflow-hidden">
                  {logoUrl ? <img src={logoUrl} className="w-full h-full object-cover" alt="Logo" /> : <LucideImageIcon className="text-white/50" />}
                </div>
                <button disabled={isUploading} onClick={() => logoFileRef.current?.click()} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">{isUploading ? <LoadingSpinner color="white" /> : <><Upload size={14} /> Upload Logo</>}</button>
                <input type="file" ref={logoFileRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">App Icon</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-indigo-600 rounded-xl border-2 border-dashed border-indigo-200 flex items-center justify-center overflow-hidden">
                  {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="Icon" /> : <ShoppingBag className="text-white/50" />}
                </div>
                <button disabled={isIconUploading} onClick={() => iconFileRef.current?.click()} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">{isIconUploading ? <LoadingSpinner color="white" /> : <><Upload size={14} /> Upload Icon</>}</button>
                <input type="file" ref={iconFileRef} className="hidden" accept="image/*" onChange={handleIconUpload} />
              </div>
            </div>
            <button disabled={isSaving} onClick={handleSaveSettings} className="w-full py-5 btn-navy rounded-2xl font-black text-[11px] uppercase tracking-[0.2em]">{isSaving ? <LoadingSpinner color="white" /> : "Save Settings"}</button>
          </div>
        </div>
      )}

      {activeAdminTab === 'support' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in">
          <div className="md:col-span-1 bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[600px]">
            <header className="p-5 border-b bg-slate-50">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Conversations</h3>
            </header>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {supportChats.length === 0 ? (
                <div className="p-10 text-center opacity-20"><MessageSquare size={32} className="mx-auto mb-2" /><p className="text-[10px] font-black uppercase">No Chats</p></div>
              ) : (
                supportChats.map(c => (
                  <button 
                    key={c.id} 
                    onClick={() => setSelectedSupportUser(c.userId)}
                    className={`w-full p-4 rounded-2xl text-left transition-all flex items-center justify-between ${selectedSupportUser === c.userId ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'hover:bg-slate-50'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black truncate">{c.userName}</p>
                      <p className={`text-[9px] truncate ${selectedSupportUser === c.userId ? 'text-white/60' : 'text-slate-400'}`}>
                        {c.messages?.[c.messages.length - 1]?.text || 'No messages'}
                      </p>
                    </div>
                    {c.unreadByAdmin && <div className="w-2 h-2 bg-red-500 rounded-full shrink-0 ml-2" />}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="md:col-span-2 bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[600px]">
            {selectedSupportUser ? (
              <SupportChatView user={user} targetUserId={selectedSupportUser} isAdmin={true} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-3">
                <MessageCircle size={48} strokeWidth={1} />
                <p className="text-[10px] font-black uppercase tracking-widest">Select a conversation</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SupportChatView: React.FC<{ user: User, targetUserId?: string, isAdmin?: boolean }> = ({ user, targetUserId, isAdmin = false }) => {
  const [chat, setChat] = useState<any>(null);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatUserId = targetUserId || user.id;

  useEffect(() => {
    const unsub = firebaseService.subscribeToSupportChat(chatUserId, (data) => {
      setChat(data);
      if (isAdmin ? data?.unreadByAdmin : data?.unreadByUser) {
        firebaseService.markSupportChatAsRead(chatUserId, isAdmin);
      }
    });
    return () => unsub();
  }, [chatUserId, isAdmin]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat?.messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const msg = text;
    setText('');
    await firebaseService.sendSupportMessage(chatUserId, user.name, msg, isAdmin);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30">
        {!chat || !chat.messages || chat.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-10 opacity-30">
            <MessageSquare size={48} strokeWidth={1} />
            <p className="text-xs font-black uppercase mt-4">No messages yet</p>
          </div>
        ) : (
          chat.messages.map((m: any, i: number) => (
            <div key={i} className={`flex flex-col ${m.senderId === (isAdmin ? 'admin' : user.id) ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[80%] p-4 rounded-2xl text-xs font-medium leading-relaxed ${m.senderId === (isAdmin ? 'admin' : user.id) ? 'bg-indigo-600 text-white rounded-tr-none shadow-lg shadow-indigo-100' : 'bg-white text-slate-900 border border-slate-100 rounded-tl-none shadow-sm'}`}>
                {m.text}
              </div>
              <span className="text-[8px] font-black text-slate-400 uppercase mt-1.5 px-1">{m.senderName} • {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSend} className="p-4 bg-white border-t flex gap-3">
        <input 
          type="text" value={text} onChange={e => setText(e.target.value)} 
          placeholder="Type your message..." 
          className="flex-1 bg-slate-50 border-none rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <button type="submit" className="p-3 bg-indigo-600 text-white rounded-2xl active:scale-90 transition-all shadow-lg shadow-indigo-100">
          <ArrowRight size={20} />
        </button>
      </form>
    </div>
  );
};

const ErrandStatusTimeline: React.FC<{ status: ErrandStatus }> = ({ status }) => {
  const stages = [
    { id: ErrandStatus.PENDING, label: 'Posted', icon: <Plus size={12} /> },
    { id: ErrandStatus.ACCEPTED, label: 'Assigned', icon: <UserCheck size={12} /> },
    { id: ErrandStatus.VERIFYING, label: 'Review', icon: <Search size={12} /> },
    { id: ErrandStatus.COMPLETED, label: 'Finished', icon: <CheckCircle size={12} /> }
  ];

  const getStatusIndex = (s: ErrandStatus) => {
    if (s === ErrandStatus.CANCELLED) return -1;
    return stages.findIndex(stage => stage.id === s);
  };

  const currentIndex = getStatusIndex(status);

  if (status === ErrandStatus.CANCELLED) {
    return (
      <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
          <X size={16} />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Errand Cancelled</p>
          <p className="text-[8px] font-bold text-red-400 uppercase">This task is no longer active</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 px-2">
      <div className="flex items-center justify-between relative">
        {/* Progress Line Background */}
        <div className="absolute top-4 left-0 right-0 h-0.5 bg-slate-100 -z-0" />
        
        {/* Active Progress Line */}
        <div 
          className="absolute top-4 left-0 h-0.5 bg-indigo-600 transition-all duration-500 -z-0" 
          style={{ width: `${Math.max(0, currentIndex) * (100 / (stages.length - 1))}%` }}
        />

        {stages.map((stage, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isPending = idx > currentIndex;

          return (
            <div key={stage.id} className="flex flex-col items-center relative z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${
                isCompleted ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 
                isCurrent ? 'bg-white border-indigo-600 text-indigo-600 shadow-xl scale-110' : 
                'bg-white border-slate-200 text-slate-300'
              }`}>
                {isCompleted ? <Check size={14} strokeWidth={3} /> : stage.icon}
              </div>
              <span className={`mt-2 text-[8px] font-black uppercase tracking-tighter transition-colors ${
                isCurrent ? 'text-indigo-600' : 'text-slate-400'
              }`}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MapView: React.FC<{ errands?: Errand[], onSelectErrand?: (e: Errand) => void, height?: string, userLocation?: Coordinates | null }> = ({ errands = [], onSelectErrand, height = "400px", userLocation }) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <div style={{ height }} className="rounded-[2rem] flex flex-col items-center justify-center bg-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-widest p-8 text-center gap-3">
        <ShieldAlert size={32} className="opacity-20" />
        <p>Google Maps API Key missing.<br/>Configure VITE_GOOGLE_MAPS_API_KEY.</p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div style={{ height }} className="rounded-[2rem] overflow-hidden border border-slate-100 shadow-inner bg-slate-50 relative">
        <Map
          defaultCenter={userLocation || { lat: -1.286389, lng: 36.817223 }}
          defaultZoom={12}
          gestureHandling={'greedy'}
          disableDefaultUI={true}
          mapId="errands_map"
        >
          {userLocation && (
            <AdvancedMarker position={userLocation}>
              <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg animate-pulse" />
            </AdvancedMarker>
          )}
          {errands.map(e => (
            e.pickupCoordinates && (
              <AdvancedMarker 
                key={e.id} 
                position={{ lat: e.pickupCoordinates.lat, lng: e.pickupCoordinates.lng }}
                onClick={() => onSelectErrand?.(e)}
              >
                <Pin background={'#000'} glyphColor={'#fff'} borderColor={'#000'} />
              </AdvancedMarker>
            )
          ))}
        </Map>
      </div>
    </APIProvider>
  );
};

const RunnerApplicationFlow: React.FC<{ user: User, onBack: () => void }> = ({ user, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    fullName: user.name,
    phone: user.phone || '',
    nationalId: '',
    idFrontUrl: '',
    idBackUrl: '',
    categoryApplied: ErrandCategory.GENERAL
  });

  const handleUpload = async (file: File, field: 'idFrontUrl' | 'idBackUrl') => {
    setLoading(true);
    try {
      const url = await cloudinaryService.uploadImage(file);
      setForm(prev => ({ ...prev, [field]: url }));
    } catch (e) { alert("Upload failed"); } finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    if (!form.nationalId || !form.idFrontUrl || !form.idBackUrl) {
      alert("Please complete all fields and uploads");
      return;
    }
    setLoading(true);
    try {
      await firebaseService.submitRunnerApplication({
        userId: user.id,
        ...form
      });
      alert("Application submitted successfully! We will review it shortly.");
      onBack();
    } catch (e) { alert("Submission failed"); } finally { setLoading(false); }
  };

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm animate-in slide-in-from-bottom-4">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-black transition-colors">
        <ChevronLeft size={16} /> Back to Profile
      </button>

      <div className="mb-8">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">Become a Runner</h2>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Join our elite team of pros</p>
      </div>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Full Name</label>
          <input type="text" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm outline-none" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">National ID Number</label>
          <input type="text" value={form.nationalId} onChange={e => setForm({...form, nationalId: e.target.value})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm outline-none" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Category</label>
          <select value={form.categoryApplied} onChange={e => setForm({...form, categoryApplied: e.target.value as ErrandCategory})} className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-sm outline-none">
            {Object.values(ErrandCategory).map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">ID Front</label>
            <div className="aspect-video bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative">
              {form.idFrontUrl ? <img src={form.idFrontUrl} className="w-full h-full object-cover" /> : <button onClick={() => document.getElementById('idFront')?.click()} className="text-[10px] font-black uppercase text-slate-400">Upload</button>}
              <input id="idFront" type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'idFrontUrl')} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">ID Back</label>
            <div className="aspect-video bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative">
              {form.idBackUrl ? <img src={form.idBackUrl} className="w-full h-full object-cover" /> : <button onClick={() => document.getElementById('idBack')?.click()} className="text-[10px] font-black uppercase text-slate-400">Upload</button>}
              <input id="idBack" type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'idBackUrl')} />
            </div>
          </div>
        </div>

        <button disabled={loading} onClick={handleSubmit} className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl active:scale-95 transition-all mt-4">
          {loading ? <LoadingSpinner color="white" /> : "Submit Application"}
        </button>
      </div>
    </div>
  );
};

const ChatSection: React.FC<{ errandId: string, messages: ChatMessage[], user: User | null, onSendMessage: (text: string) => void }> = ({ errandId, messages, user, onSendMessage }) => {
  const [text, setText] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && !isCollapsed) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isCollapsed]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text);
    setText('');
  };

  return (
    <div className={`flex flex-col bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden transition-all duration-300 ${isCollapsed ? 'h-[50px]' : 'h-[400px]'}`}>
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="p-3 border-b bg-white flex items-center justify-between w-full hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-indigo-600" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">Live Chat</span>
          {messages.length > 0 && isCollapsed && (
            <span className="bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">{messages.length}</span>
          )}
        </div>
        {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {!isCollapsed && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50 gap-2">
                <MessageSquare size={32} strokeWidth={1} />
                <p className="text-[10px] font-bold uppercase">No messages yet</p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.senderId === user?.id ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-xs font-medium ${m.senderId === user?.id ? 'bg-black text-white rounded-tr-none' : 'bg-white text-slate-900 border border-slate-100 rounded-tl-none shadow-sm'}`}>
                    {m.text}
                  </div>
                  <span className="text-[8px] font-black text-slate-400 uppercase mt-1 px-1">{m.senderName} • {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))
            )}
          </div>
          <form onSubmit={handleSend} className="p-3 bg-white border-t flex gap-2">
            <input 
              type="text" value={text} onChange={e => setText(e.target.value)} 
              placeholder="Type a message..." 
              className="flex-1 bg-slate-50 border-none rounded-xl px-4 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-black/5"
            />
            <button type="submit" className="p-2 bg-black text-white rounded-xl active:scale-90 transition-all">
              <ArrowRight size={18} />
            </button>
          </form>
        </>
      )}
    </div>
  );
};

const UserSettings: React.FC<{ user: User, isDarkMode: boolean, onToggleDarkMode: () => void }> = ({ user, isDarkMode, onToggleDarkMode }) => {
  const [notifSettings, setNotifSettings] = useState(user.notificationSettings || { email: true, push: true, sms: false });

  const handleToggleNotif = async (key: keyof typeof notifSettings) => {
    const updated = { ...notifSettings, [key]: !notifSettings[key] };
    setNotifSettings(updated);
    await firebaseService.updateUserSettings(user.id, { notificationSettings: updated });
  };

  return (
    <div className="space-y-6 text-left">
      <div className="space-y-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Notifications</h3>
        <div className="space-y-2">
          {Object.entries(notifSettings).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
              <span className="text-xs font-black uppercase tracking-tight text-slate-700">{key} Notifications</span>
              <button 
                onClick={() => handleToggleNotif(key as any)}
                className={`w-12 h-6 rounded-full transition-all relative ${val ? 'bg-indigo-600' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${val ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Appearance</h3>
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
          <span className="text-xs font-black uppercase tracking-tight text-slate-700">Dark Mode</span>
          <button 
            onClick={onToggleDarkMode}
            className={`w-12 h-6 rounded-full transition-all relative ${isDarkMode ? 'bg-indigo-600' : 'bg-slate-200'}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isDarkMode ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

const ProfileEditor: React.FC<{ user: User, onUpdate: (updates: Partial<User>) => void, onBack: () => void }> = ({ user, onUpdate, onBack }) => {
  const [formData, setFormData] = useState({
    name: user.name,
    phone: user.phone || '',
    biography: user.biography || '',
    avatar: user.avatar || ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const url = await cloudinaryService.uploadImage(file, 'profile_pictures');
      setFormData({ ...formData, avatar: url });
    } catch (e) {
      alert("Avatar upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await firebaseService.updateUserSettings(user.id, formData);
      onUpdate(formData);
      alert("Profile updated successfully!");
      onBack();
    } catch (e) {
      alert("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const isPhoneDisabled = !!user.phone;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 bg-slate-100 rounded-xl text-slate-500"><ChevronLeft size={20} /></button>
        <h2 className="text-xl font-black text-slate-900">Edit Profile</h2>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
        <div className="flex flex-col items-center gap-4 mb-4">
          <div className="relative group">
            <img 
              src={formData.avatar || `https://i.pravatar.cc/150?u=${user.id}`} 
              className="w-24 h-24 rounded-[2rem] object-cover border-4 border-slate-50 shadow-lg" 
              alt="Avatar"
            />
            <button 
              type="button"
              onClick={() => document.getElementById('avatar-upload')?.click()}
              className="absolute inset-0 bg-black/40 rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
            >
              <Camera size={24} />
            </button>
          </div>
          <input 
            id="avatar-upload" 
            type="file" 
            className="hidden" 
            accept="image/*" 
            onChange={handleAvatarUpload} 
          />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {isUploading ? 'Uploading...' : 'Tap photo to change'}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Full Name</label>
          <input 
            type="text" 
            value={formData.name} 
            onChange={e => setFormData({...formData, name: e.target.value})} 
            className="w-full p-4 brand-input rounded-2xl font-bold text-black outline-none" 
            required 
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Email (Read-only)</label>
          <input 
            type="email" 
            value={user.email} 
            className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-slate-400 outline-none cursor-not-allowed" 
            disabled 
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Phone Number {isPhoneDisabled && '(Locked)'}</label>
          <input 
            type="tel" 
            value={formData.phone} 
            onChange={e => setFormData({...formData, phone: e.target.value})} 
            className={`w-full p-4 rounded-2xl font-bold outline-none ${isPhoneDisabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'brand-input text-black'}`} 
            disabled={isPhoneDisabled}
            placeholder="+254..."
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Biography</label>
          <textarea 
            value={formData.biography} 
            onChange={e => setFormData({...formData, biography: e.target.value})} 
            placeholder="Tell us about yourself..." 
            className="w-full p-4 brand-input rounded-2xl font-bold text-slate-900 outline-none h-32 resize-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <button 
          disabled={isSaving} 
          className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all"
        >
          {isSaving ? <LoadingSpinner color="white" /> : "Save Changes"}
        </button>
      </form>
    </div>
  );
};

const TaskHistory: React.FC<{ user: User, onBack: () => void, onSelectErrand: (e: Errand) => void }> = ({ user, onBack, onSelectErrand }) => {
  const [errands, setErrands] = useState<Errand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = firebaseService.subscribeToUserErrands(user.id, user.role, (data) => {
      setErrands(data.sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    });
    return () => unsub();
  }, [user.id, user.role]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 bg-slate-100 rounded-xl text-slate-500"><ChevronLeft size={20} /></button>
        <h2 className="text-xl font-black text-slate-900">Task History</h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner /></div>
      ) : errands.length === 0 ? (
        <div className="bg-white p-12 rounded-[2rem] border border-slate-100 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
            <ShoppingBag size={32} />
          </div>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No tasks found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {errands.map(e => (
            <div key={e.id} onClick={() => onSelectErrand(e)} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-black text-slate-900 group-hover:text-indigo-600 transition-colors">{e.title}</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{new Date(e.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg border ${
                  e.status === ErrandStatus.COMPLETED ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                  e.status === ErrandStatus.CANCELLED ? 'bg-red-50 text-red-600 border-red-100' :
                  'bg-amber-50 text-amber-600 border-amber-100'
                }`}>
                  {e.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-emerald-600">Ksh {e.acceptedPrice || e.budget}</p>
                <ChevronRight size={14} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ErrandDetailScreen: React.FC<any> = ({ selectedErrand, setSelectedErrand, user, refresh, onRunnerComplete, loading }) => {
  const [comments, setComments] = useState(selectedErrand.runnerComments || '');
  const [photo, setPhoto] = useState<string | null>(selectedErrand.completionPhoto || null);
  const [showCamera, setShowCamera] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleDeadline, setRescheduleDeadline] = useState(selectedErrand.deadline || '');
  const [reassignReason, setReassignReason] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ description: selectedErrand.description || '', budget: selectedErrand.budget || 0, deadline: selectedErrand.deadline || '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const chatSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editMode) {
      setEditForm({
        description: selectedErrand.description || '',
        budget: selectedErrand.budget || 0,
        deadline: selectedErrand.deadline || ''
      });
    }
  }, [selectedErrand.description, selectedErrand.budget, selectedErrand.deadline, editMode]);

  const isRequester = user.id === selectedErrand.requesterId;
  const isRunner = user.id === selectedErrand.runnerId;

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const url = await cloudinaryService.uploadImage(file);
      setPhoto(url);
      if (selectedErrand.status === ErrandStatus.VERIFYING) {
        await firebaseService.submitForReview(selectedErrand.id, comments, url);
        refresh();
      }
    } catch (err) { alert("Upload failed."); } finally { setIsUploading(false); setShowCamera(false); }
  };

  const handleAcceptBudget = async () => {
    if (!user) return;
    const input = window.prompt(`The budget is Ksh ${selectedErrand.budget}. You can accept this or enter a higher bid amount (Ksh):`, selectedErrand.budget.toString());
    if (input === null) return;
    
    const amount = parseInt(input);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    // Bid Validation: Max 50% above budget
    const maxAllowedBid = Math.ceil(selectedErrand.budget * 1.5);
    if (amount > maxAllowedBid) {
      alert(`Your bid of Ksh ${amount} is too high. Bids for this task cannot exceed Ksh ${maxAllowedBid} (50% above budget).`);
      return;
    }

    try {
      if (amount <= selectedErrand.budget) {
        await firebaseService.acceptBid(selectedErrand.id, user.id, amount);
        alert("Task assigned to you automatically!");
      } else {
        await firebaseService.placeBid(selectedErrand.id, user.id, user.name, amount, 'Ready now');
        alert("Your higher bid has been submitted for approval.");
      }
    } catch (e) { alert("Action failed."); }
  };

  const handleSendMessage = async (text: string) => {
    if (!user) return;
    try {
      await firebaseService.sendMessage(selectedErrand.id, user.id, user.name, text);
    } catch (e) { console.error("Failed to send message:", e); }
  };

  const handleReassign = async () => {
    if (!reassignReason) { alert("Please select a reason for reassignment."); return; }
    
    if (selectedErrand.status === ErrandStatus.VERIFYING) {
      try {
        await firebaseService.requestReassignment(selectedErrand.id, reassignReason);
        setIsReassigning(false);
        alert("Reassignment request sent to the runner for approval.");
      } catch (e) { alert("Failed to request reassignment."); }
    } else {
      try {
        await firebaseService.reassignErrand(selectedErrand.id, reassignReason);
        setIsReassigning(false);
        alert("Runner reassigned successfully.");
      } catch (e) { alert("Failed to reassign runner."); }
    }
  };

  const handleSaveChanges = async () => {
    try {
      await firebaseService.updateErrand(selectedErrand.id, editForm);
      setEditMode(false);
      alert("Changes saved.");
    } catch (e) { alert("Failed to save changes."); }
  };

  const handleReschedule = async () => {
    if (!rescheduleDeadline) { alert("Please select a new deadline."); return; }
    try {
      await firebaseService.updateErrand(selectedErrand.id, { deadline: rescheduleDeadline });
      setIsRescheduling(false);
      alert("Errand rescheduled successfully.");
    } catch (e) { alert("Failed to reschedule errand."); }
  };

  const handleCancelErrand = async () => {
    if (!window.confirm("Are you sure you want to cancel this errand? All bidders will be notified.")) return;
    try {
      await firebaseService.cancelErrand(selectedErrand.id);
      setSelectedErrand(null);
      alert("Errand cancelled successfully.");
    } catch (e: any) { alert(e.message || "Failed to cancel errand."); }
  };

  const scrollToChat = () => {
    chatSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const REASSIGN_REASONS = ["Wait time too long", "Budget bid so high", "Communication issues", "Runner changed their mind", "Other"];

  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex flex-col items-center justify-end md:justify-center p-0 md:p-6">
      {showCamera && <CameraCapture onCapture={handleUpload} onClose={() => setShowCamera(false)} />}
      {fullScreenImage && <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-6" onClick={() => setFullScreenImage(null)}><img src={fullScreenImage} className="max-w-full max-h-full object-contain rounded-xl" alt="Proof" /></div>}
      <div className="w-full max-w-2xl bg-white rounded-t-[3rem] md:rounded-[3rem] shadow-2xl overflow-y-auto max-h-[95vh] animate-in slide-in-from-bottom-6">
        <header className="px-6 py-5 border-b border-slate-50 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedErrand(null)} className="p-2.5 bg-slate-100 rounded-xl text-slate-500"><ChevronLeft size={20} /></button>
            <div className="min-w-0"><h3 className="font-black text-slate-900 text-base truncate leading-tight">{selectedErrand.title}</h3><span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border ${selectedErrand.status === ErrandStatus.PENDING ? 'bg-amber-50 text-amber-600 border-amber-100' : selectedErrand.status === ErrandStatus.ACCEPTED ? 'bg-blue-50 text-blue-600 border-blue-100' : selectedErrand.status === ErrandStatus.COMPLETED ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-black border-slate-200'}`}>{selectedErrand.status}</span></div>
          </div>
          <div className="text-right shrink-0"><p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Budget</p><p className="text-base font-black text-emerald-600">Ksh {selectedErrand.budget}</p></div>
        </header>
        <div className="p-6 space-y-6">
          <ErrandStatusTimeline status={selectedErrand.status} />
          {isReassigning ? (
            <section className="space-y-4 animate-in fade-in zoom-in-95"><h4 className="text-sm font-black uppercase tracking-widest text-slate-900">Why reassign?</h4><div className="space-y-2">{REASSIGN_REASONS.map((r, idx) => (<button key={idx} onClick={() => setReassignReason(r)} className={`w-full text-left p-4 rounded-2xl border-2 font-bold text-xs transition-all ${reassignReason === r ? 'border-black bg-slate-50' : 'border-slate-100'}`}>{r}</button>))}</div><div className="flex gap-3"><button onClick={() => setIsReassigning(false)} className="flex-1 py-4 border border-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest">Cancel</button><button onClick={handleReassign} className="flex-1 py-4 bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest">Confirm Reassign</button></div></section>
          ) : isRescheduling ? (
            <section className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
              <h4 className="text-sm font-black uppercase tracking-widest text-slate-900">Reschedule Errand</h4>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">New Deadline</label>
                  <input 
                    type="datetime-local" 
                    value={rescheduleDeadline} 
                    onChange={e => setRescheduleDeadline(e.target.value)} 
                    className="w-full p-4 brand-input rounded-xl font-bold text-xs outline-none" 
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setIsRescheduling(false)} className="flex-1 py-4 border border-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest">Cancel</button>
                <button onClick={handleReschedule} className="flex-1 py-4 bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2">
                  <Clock size={14} /> Confirm Reschedule
                </button>
              </div>
            </section>
          ) : editMode ? (
            <section className="space-y-5 animate-in fade-in slide-in-from-bottom-2"><h4 className="text-sm font-black uppercase tracking-widest text-slate-900">Edit Errand</h4><div className="space-y-4"><div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description</label><textarea value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className="w-full p-4 brand-input rounded-xl font-bold text-xs outline-none h-24 resize-none" /></div><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Budget (Ksh)</label><input type="number" value={editForm.budget} onChange={e => setEditForm({...editForm, budget: parseInt(e.target.value)})} className="w-full p-4 brand-input rounded-xl font-bold text-xs outline-none" /></div><div className="space-y-1"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Deadline</label><input type="datetime-local" value={editForm.deadline} onChange={e => setEditForm({...editForm, deadline: e.target.value})} className="w-full p-4 brand-input rounded-xl font-bold text-xs outline-none" /></div></div></div><div className="flex gap-3"><button onClick={() => setEditMode(false)} className="flex-1 py-4 border border-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest">Cancel</button><button onClick={handleSaveChanges} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"><Save size={14} /> Save Changes</button></div></section>
          ) : (
            <>
              <section className="bg-slate-50 rounded-[1.5rem] p-5 space-y-3">
                <div className="flex justify-between items-start"><div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Requester</p><p className="text-xs font-black text-slate-900">{selectedErrand.requesterName}</p></div><div className="text-right"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Distance</p><p className="text-xs font-black text-slate-900">{selectedErrand.distanceKm || '--'} KM</p></div></div>
                
                {(selectedErrand.status === ErrandStatus.ACCEPTED || selectedErrand.status === ErrandStatus.VERIFYING || selectedErrand.status === ErrandStatus.COMPLETED) && selectedErrand.pickupCoordinates && selectedErrand.dropoffCoordinates && (
                  <div className="h-40 w-full rounded-2xl overflow-hidden border border-slate-200 shadow-sm animate-in zoom-in-95">
                    <Map 
                      defaultCenter={{ lat: selectedErrand.pickupCoordinates.lat, lng: selectedErrand.pickupCoordinates.lng }} 
                      defaultZoom={13} 
                      gestureHandling={'greedy'}
                      disableDefaultUI={true}
                      mapId="errand_detail_map"
                    >
                      <AdvancedMarker position={{ lat: selectedErrand.pickupCoordinates.lat, lng: selectedErrand.pickupCoordinates.lng }}>
                        <Pin background={'#000'} glyphColor={'#fff'} borderColor={'#000'} />
                      </AdvancedMarker>
                      <AdvancedMarker position={{ lat: selectedErrand.dropoffCoordinates.lat, lng: selectedErrand.dropoffCoordinates.lng }}>
                        <Pin background={'#4f46e5'} glyphColor={'#fff'} borderColor={'#4f46e5'} />
                      </AdvancedMarker>
                    </Map>
                  </div>
                )}

                <div><div className="flex items-center justify-between mb-1.5"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Task Details</p>{isRequester && selectedErrand.status === ErrandStatus.PENDING && (<button onClick={() => setEditMode(true)} className="flex items-center gap-1 text-[9px] font-black text-indigo-600 uppercase"><Edit2 size={10} /> Edit</button>)}</div><div className="bg-white/80 p-3 rounded-xl border border-white shadow-sm space-y-2"><p className="text-xs font-medium text-slate-600 leading-relaxed">{selectedErrand.description || "No description provided."}</p>{selectedErrand.category === ErrandCategory.MAMA_FUA && (<div className="space-y-2"><div className="p-2 bg-slate-50 rounded-lg flex items-center justify-between"><span className="text-[10px] font-black text-slate-400 uppercase">Quantity</span><span className="text-xs font-black text-black">{selectedErrand.laundryBaskets} Baskets</span></div>{selectedErrand.isInHouse && (<div className="p-2 bg-indigo-50 rounded-lg flex items-center gap-2 text-indigo-600"><Home size={12} /><span className="text-[10px] font-black uppercase tracking-widest">In-House Service</span></div>)}</div>)}{selectedErrand.category === ErrandCategory.HOUSE_HUNTING && (<div className="p-2 bg-slate-50 rounded-lg space-y-1"><div className="flex justify-between"><span className="text-[10px] font-black text-slate-400 uppercase">Type</span><span className="text-xs font-black text-black">{selectedErrand.houseType}</span></div><div className="flex justify-between"><span className="text-[10px] font-black text-slate-400 uppercase">Budget Range</span><span className="text-xs font-black text-black">Ksh {selectedErrand.minBudget} - {selectedErrand.maxBudget}</span></div></div>)}</div></div>
              </section>
              {selectedErrand.status === ErrandStatus.PENDING && (isRequester ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setEditMode(true)} 
                      className="py-4 border-2 border-dashed border-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest hover:bg-indigo-50 transition-all"
                    >
                      <Edit2 size={14} /> Edit Details
                    </button>
                    <button 
                      onClick={() => setIsRescheduling(true)} 
                      className="py-4 border-2 border-dashed border-slate-200 text-slate-600 rounded-2xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all"
                    >
                      <Clock size={14} /> Reschedule
                    </button>
                  </div>
                  
                  <button 
                    onClick={handleCancelErrand}
                    className="w-full py-4 border-2 border-dashed border-red-100 text-red-500 rounded-2xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition-all"
                  >
                    <Trash2 size={14} /> Cancel Errand
                  </button>
                  
                  <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase text-slate-400 px-1 tracking-widest">Proposals Received</p>
                    {selectedErrand.bids.length === 0 ? (
                      <div className="p-10 border-2 border-dashed border-slate-100 rounded-[1.5rem] text-center text-slate-300 font-bold">Waiting for runners...</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {selectedErrand.bids.map((b: any, i: number) => (
                          <div key={i} className="bg-white border border-slate-100 p-4 rounded-2xl flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-3">
                              <img src={`https://ui-avatars.com/api/?name=${b.runnerName}&background=000&color=fff`} className="w-10 h-10 rounded-xl" />
                              <div>
                                <p className="text-sm font-black text-slate-900">{b.runnerName}</p>
                                <p className="text-[9px] font-bold text-black uppercase tracking-widest">Ready: {b.eta || 'Now'}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-slate-900 mb-1.5">Ksh {b.price}</p>
                              <button onClick={() => firebaseService.acceptBid(selectedErrand.id, b.runnerId, b.price)} className="px-5 py-2 bg-black text-white text-[9px] font-black uppercase rounded-lg">Assign</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <button onClick={handleAcceptBudget} className="w-full py-5 bg-black text-white rounded-[1.5rem] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all text-sm">
                    Accept Task (Ksh {selectedErrand.budget})
                  </button>
                  <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-[9px] font-black text-slate-400 uppercase text-center">
                      Accepting at the current budget assigns the task to you instantly!
                    </p>
                  </div>
                </div>
              ))}
              {(selectedErrand.status === ErrandStatus.ACCEPTED || selectedErrand.status === ErrandStatus.VERIFYING) && (isRequester || isRunner) && (
                <div ref={chatSectionRef}>
                  <ChatSection 
                    errandId={selectedErrand.id} 
                    messages={selectedErrand.chat || []} 
                    user={user} 
                    onSendMessage={handleSendMessage} 
                  />
                </div>
              )}
              {isRunner && selectedErrand.reassignmentRequested && (
                <div className="p-5 bg-amber-50 border border-amber-100 rounded-[2rem] space-y-4 animate-in zoom-in-95">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 text-amber-600 rounded-lg"><ShieldAlert size={18} /></div>
                    <div>
                      <p className="text-xs font-black text-slate-900 uppercase tracking-tight">Reassignment Requested</p>
                      <p className="text-[10px] text-slate-500 font-bold">Reason: {selectedErrand.reassignReason}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => firebaseService.rejectReassignment(selectedErrand.id)}
                      className="flex-1 py-3 border border-amber-200 text-amber-600 rounded-xl font-black text-[9px] uppercase tracking-widest"
                    >
                      Reject
                    </button>
                    <button 
                      onClick={() => firebaseService.approveReassignment(selectedErrand.id)}
                      className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest"
                    >
                      Approve & Release
                    </button>
                  </div>
                </div>
              )}
              {isRequester && selectedErrand.reassignmentRequested && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-center animate-pulse">
                  <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Waiting for runner to approve reassignment</p>
                </div>
              )}
              {(selectedErrand.status === ErrandStatus.ACCEPTED || selectedErrand.status === ErrandStatus.VERIFYING) && isRequester && (
                <div className="space-y-3">
                  <button 
                    onClick={scrollToChat}
                    className="w-full py-4 bg-black text-white rounded-2xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                  >
                    <MessageSquare size={16} /> Contact Runner
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setIsRescheduling(true)} className="py-4 border border-slate-200 text-slate-600 rounded-2xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all">
                      <Clock size={16} /> Reschedule
                    </button>
                    <button 
                      disabled={selectedErrand.reassignmentRequested}
                      onClick={() => setIsReassigning(true)} 
                      className="py-4 border border-red-100 text-red-500 rounded-2xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition-all disabled:opacity-50"
                    >
                      <UserMinus size={16} /> {selectedErrand.reassignmentRequested ? 'Requested' : 'Reassign'}
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 text-center uppercase font-bold px-4">You can reschedule or reassign the runner if needed.</p>
                </div>
              )}
              {(selectedErrand.status === ErrandStatus.ACCEPTED || selectedErrand.status === ErrandStatus.VERIFYING) && isRunner && (
                <div className="bg-black rounded-[2rem] p-6 text-white space-y-5 shadow-2xl">
                  <div className="flex items-center justify-between"><h4 className="text-lg font-black uppercase tracking-widest">Execution Board</h4></div>
                  <div className="space-y-1.5"><label className="text-[9px] font-black uppercase tracking-widest text-slate-300 ml-1">Comments</label><textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Work progress update..." className="w-full p-4 bg-white/10 rounded-2xl border-none text-white placeholder:text-slate-500 font-bold outline-none h-24 resize-none text-xs" /></div>
                  <div className="space-y-3">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-300">Proof Image</label>
                    <div className="grid grid-cols-2 gap-3"><button onClick={() => setShowCamera(true)} className="py-3 bg-white/10 rounded-xl flex items-center justify-center gap-2 font-black text-[9px] uppercase"><Camera size={16} /> Camera</button><button onClick={() => fileRef.current?.click()} className="py-3 bg-white/10 rounded-xl flex items-center justify-center gap-2 font-black text-[9px] uppercase"><ImageIcon size={16} /> Gallery</button><input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} /></div>
                    {(photo || isUploading) && (<div className="relative rounded-2xl overflow-hidden border-2 border-white/20 h-40 bg-black/10 flex items-center justify-center">{isUploading ? <LoadingSpinner color="white" /> : <img src={photo!} className="w-full h-full object-cover" alt="Proof" onClick={() => setFullScreenImage(photo)} />}</div>)}
                  </div>
                  <button disabled={loading || isUploading} onClick={() => onRunnerComplete(selectedErrand.id, comments, photo || undefined)} className="w-full py-5 bg-white text-black rounded-[1.5rem] font-black uppercase text-xs tracking-widest disabled:opacity-50">{loading ? <LoadingSpinner color="black" /> : 'Complete & Submit'}</button>
                </div>
              )}
              {selectedErrand.status === ErrandStatus.VERIFYING && isRequester && (
                <div className="bg-emerald-600 rounded-[2rem] p-6 text-white space-y-5"><h4 className="text-lg font-black uppercase tracking-widest text-center">Verification</h4>{selectedErrand.completionPhoto && (<img src={selectedErrand.completionPhoto} className="w-full h-48 object-cover rounded-2xl border-4 border-white/20 shadow-xl" alt="Proof" onClick={() => setFullScreenImage(selectedErrand.completionPhoto)} />)}<div className="bg-white/10 p-4 rounded-xl text-xs font-semibold italic border border-white/5">"{selectedErrand.runnerComments || 'No comments.'}"</div><button disabled={loading} onClick={() => firebaseService.completeErrand(selectedErrand.id, 'SIGNED', 5)} className="w-full py-5 bg-white text-emerald-600 rounded-[1.5rem] font-black uppercase text-xs tracking-widest shadow-xl">Approve & Release Funds</button></div>
              )}
              {selectedErrand.status === ErrandStatus.COMPLETED && (<div className="bg-slate-50 rounded-[1.5rem] p-6 border border-slate-200 text-center space-y-2"><div className="w-12 h-12 bg-black text-white rounded-full flex items-center justify-center mx-auto mb-2"><CheckCircle size={24} /></div><h4 className="text-lg font-black text-slate-900">Task Completed</h4><p className="text-[10px] font-black text-slate-400 uppercase">Closed on {new Date(selectedErrand.completedAt!).toLocaleDateString()}</p></div>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
};