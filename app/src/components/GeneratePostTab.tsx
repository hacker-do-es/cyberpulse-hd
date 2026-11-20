import { useState, useCallback, useRef, useEffect } from 'react';
import { loadPostFont } from '@/lib/loadPostFont';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
  ClipboardCopy,
  Save,
  ThumbsUp,
  MessageCircle,
  Repeat2,
  Send,
  Globe,
  Check,
  AlertCircle,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { timeAgo } from '@/lib/dateUtils';
import ArticlePicker, { type StackFilterSource } from './ArticlePicker';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { NewsArticle } from '@/data/mockNews';
import { generateAiPost, type GenerateAiPostParams } from '@/services/apiService';import { getLang, tr } from '@/lib/i18n';
import { LinkedInPublishButton } from './hd/LinkedIn';
import { LinkedInSchedulePanel } from './hd/LinkedInQueue';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

import { generateDailyDigestPost, generateMockPost, type Format, type Language, type Length, type Tone } from '../../server/shared/postTemplates';

interface SavedPost {
  id: string;
  title: string;
  content: string;
  sourceArticleTitle: string;
  sourceArticleUrl: string;
  tone: string;
  format: string;
  length: string;
  createdAt: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  visible: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const severityColor = (s: string) => {
  switch (s) {
    case 'critical': return 'bg-[#EF4444]';
    case 'high': return 'bg-[#F97316]';
    case 'medium': return 'bg-[#EAB308]';
    case 'low': return 'bg-[#22C55E]';
    default: return 'bg-[#8B949E]';
  }
};

const toneLabel = (t: Tone) => {
  switch (t) {
    case 'Professional': return 'Professional';
    case 'Casual': return 'Casual / Conversational';
    case 'Urgent': return 'Urgent / Breaking News';
    case 'Educational': return 'Educational';
    case 'Thought Leadership': return 'Thought Leadership';
  }
};

const lengthWordCount = (l: Length) => {
  switch (l) {
    case 'short': return '~100-150 words';
    case 'medium': return '~200-250 words';
    case 'long': return '~300-400 words';
  }
};

function splitIntoSlides(content: string): string[] {
  const lines = content.split('\n');
  const slides: string[] = [];
  let currentSlide = '';

  const slidePattern = /^(\d+[\d\W]*|[\d\d\W]|[\u{1F1E6}-\u{1F1FF}\u{2702}-\u{27B0}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*\d+|[\u2705\u274C\u26A0\u{1F4A1}\u{1F510}\u{1F4DD}\u{1F4E2}\u{1F6A8}\u{1F4BC}\u{1F4DA}\u{1F3AF}\u2615\u{1F534}\u{1F7E0}\u{1F7E1}\u{1F7E2}]\s*\d+)/u;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentSlide) {
        currentSlide += '\n';
      }
      continue;
    }

    const isSlideStart = /^\d+\W|^\d+[\d\W]\s/.test(trimmed) || slidePattern.test(trimmed);

    if (isSlideStart && currentSlide.trim()) {
      slides.push(currentSlide.trim());
      currentSlide = trimmed;
    } else {
      currentSlide += (currentSlide ? '\n' : '') + trimmed;
    }
  }

  if (currentSlide.trim()) {
    slides.push(currentSlide.trim());
  }

  if (slides.length === 0 && content.trim()) {
    return [content.trim()];
  }

  return slides.length > 0 ? slides : [''];
}

/* ------------------------------------------------------------------ */
/*  Translation helpers                                                */
/* ------------------------------------------------------------------ */

function getLabels(lang: Language) {
  if (lang === 'es') {
    return {
      sourceArticle: 'ARTÍCULO FUENTE',
      generatePost: 'GENERAR PUBLICACIÓN',
      editPost: 'EDITAR PUBLICACIÓN',
      linkedinPreview: 'VISTA PREVIA DE LINKEDIN',
      carouselPreview: 'VISTA PREVIA DEL CARRUSEL',
      tone: 'TONO',
      format: 'FORMATO',
      length: 'LONGITUD',
      language: 'IDIOMA',
      selectArticles: 'SELECCIONAR ARTÍCULOS',
      selected: 'seleccionados',
      articlesWillBeIncluded: 'artículos serán incluidos',
      backToNews: 'Volver al Feed de Noticias',
      openOriginal: 'Abrir Original',
      generateBtn: 'Generar Publicación',
      generating: 'Generando...',
      regenerate: 'Regenerar',
      copy: 'Copiar al Portapapeles',
      copied: '¡Copiado!',
      save: 'Guardar Publicación',
      like: 'Me gusta',
      comment: 'Comentar',
      repost: 'Republicar',
      send: 'Enviar',
      reactions: 'reacciones',
      comments: 'comentarios',
      now: 'Ahora',
      tomorrow9: 'Mañana 9AM',
      tomorrow12: 'Mañana 12PM',
      bestTime: 'Mejor hora',
      schedulePost: 'PROGRAMAR PUBLICACIÓN',
      date: 'Fecha',
      time: 'Hora',
      scheduleBtn: 'Programar',
      scheduledPosts: 'Publicaciones Programadas',
      noScheduled: 'No hay publicaciones programadas',
      delete: 'Eliminar',
      short: 'Corto',
      medium: 'Medio',
      long: 'Largo',
    };
  }

  return {
    sourceArticle: 'SOURCE ARTICLE',
    generatePost: 'GENERATE POST',
    editPost: 'EDIT POST',
    linkedinPreview: 'LINKEDIN PREVIEW',
    carouselPreview: 'CAROUSEL PREVIEW',
    tone: 'TONE',
    format: 'FORMAT',
    length: 'LENGTH',
    language: 'LANGUAGE',
    selectArticles: 'SELECT ARTICLES',
    selected: 'selected',
    articlesWillBeIncluded: 'articles will be included',
    backToNews: 'Back to News Feed',
    openOriginal: 'Open Original',
    generateBtn: 'Generate Post',
    generating: 'Generating...',
    regenerate: 'Regenerate',
    copy: 'Copy to Clipboard',
    copied: 'Copied!',
    save: 'Save Post',
    like: 'Like',
    comment: 'Comment',
    repost: 'Repost',
    send: 'Send',
    reactions: 'reactions',
    comments: 'comments',
    now: 'Now',
    tomorrow9: 'Tomorrow 9AM',
    tomorrow12: 'Tomorrow 12PM',
    bestTime: 'Best Time',
    schedulePost: 'SCHEDULE POST',
    date: 'Date',
    time: 'Time',
    scheduleBtn: 'Schedule',
    scheduledPosts: 'Scheduled Posts',
    noScheduled: 'No scheduled posts',
    delete: 'Delete',
    short: 'Short',
    medium: 'Medium',
    long: 'Long',
  };
}

/* ------------------------------------------------------------------ */
/*  Toast Component                                                    */
/* ------------------------------------------------------------------ */

function ToastNotification({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast.visible) return;
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [toast.visible, onDismiss]);

  return (
    <AnimatePresence>
      {toast.visible && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] as [number, number, number, number] }}
          className="fixed top-4 right-4 z-[100] flex items-center gap-3 rounded-lg border border-[#2A3140] bg-[#1A1F2E] px-4 py-3 shadow-lg"
        >
          {toast.type === 'success' ? (
            <Check size={16} className="text-[#E8533F] shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-[#EF4444] shrink-0" />
          )}
          <span className="text-sm font-inter text-[#E6EDF3]">{toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  LinkedIn Preview                                                   */
/* ------------------------------------------------------------------ */

function LinkedInPreview({ content, lang }: { content: string; lang: Language }) {
  const labels = getLabels(lang);
  const truncated = content.length > 210 ? content.slice(0, 210) + '...' : content;
  const seeMore = content.length > 210;

  return (
    <div className="rounded-lg overflow-hidden border border-[#E6EDF3] bg-white">
      {/* Post Header */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-[#0D1117] font-semibold text-base"
          style={{
            background: 'linear-gradient(135deg, #E8533F 0%, #008F6B 100%)',
          }}
        >
          {tr("AC")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[14px] text-[#232A36] font-inter">{tr("Alex Chen")}</span>
          </div>
          <p className="text-[12px] text-[#768390] font-inter leading-tight">
            {tr("Cybersecurity Analyst | CISSP | Cloud Security")}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[12px] text-[#768390] font-inter">
              {lang === 'es' ? 'Justo ahora' : 'Just now'}
            </span>
            <span className="text-[#768390]">·</span>
            <Globe size={12} className="text-[#768390]" />
          </div>
        </div>
      </div>

      {/* Post Body */}
      <div className="px-4 pb-3">
        <p className="text-[14px] leading-[1.5] text-[#232A36] font-[system-ui] whitespace-pre-wrap">
          {truncated}
          {seeMore && (
            <span className="text-[#0A66C2] font-medium cursor-pointer">
              {lang === 'es' ? ' ...ver más' : ' ...see more'}
            </span>
          )}
        </p>
      </div>

      {/* Footer Icons */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#E6EDF3]">
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <ThumbsUp size={20} />
          <span className="text-[12px] font-inter">{labels.like}</span>
        </button>
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <MessageCircle size={20} />
          <span className="text-[12px] font-inter">{labels.comment}</span>
        </button>
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <Repeat2 size={20} />
          <span className="text-[12px] font-inter">{labels.repost}</span>
        </button>
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <Send size={20} />
          <span className="text-[12px] font-inter">{labels.send}</span>
        </button>
      </div>

      {/* Engagement Bar */}
      <div className="bg-[#F3F2EF] px-4 py-2.5">
        <p className="text-[12px] text-[#768390] font-inter">
          5 {labels.reactions} · 12 {labels.comments}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Carousel Preview                                                   */
/* ------------------------------------------------------------------ */

function CarouselPreview({ content, lang }: { content: string; lang: Language }) {
  const slides = splitIntoSlides(content);
  const [currentIndex, setCurrentIndex] = useState(0);
  const labels = getLabels(lang);

  const goToPrev = () => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : slides.length - 1));
  const goToNext = () => setCurrentIndex((prev) => (prev < slides.length - 1 ? prev + 1 : 0));

  return (
    <div className="rounded-lg overflow-hidden border border-[#E6EDF3] bg-[#F3F2EF]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E6EDF3] flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[#0D1117] font-semibold text-sm"
          style={{
            background: 'linear-gradient(135deg, #E8533F 0%, #008F6B 100%)',
          }}
        >
          {tr("AC")}
        </div>
        <div>
          <div className="font-semibold text-[13px] text-[#232A36] font-inter">{tr("Alex Chen")}</div>
          <div className="text-[11px] text-[#768390] font-inter">
            {lang === 'es' ? 'Documento de LinkedIn' : 'LinkedIn Document'}
          </div>
        </div>
      </div>

      {/* Slide Viewer */}
      <div className="relative px-4 py-4">
        <div className="bg-white rounded-lg border border-[#E6EDF3] min-h-[240px] flex flex-col">
          {/* Slide header */}
          <div className="px-4 py-2 border-b border-[#E6EDF3] flex items-center justify-between">
            <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B]">
              {lang === 'es' ? 'Diapositiva' : 'Slide'} {currentIndex + 1}/{slides.length}
            </span>
          </div>

          {/* Slide content */}
          <div className="flex-1 px-4 py-4 relative overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] as [number, number, number, number] }}
                className="text-[14px] leading-[1.6] text-[#232A36] font-[system-ui] whitespace-pre-wrap"
              >
                {slides[currentIndex]}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation arrows inside the card */}
          {slides.length > 1 && (
            <>
              <button
                onClick={goToPrev}
                className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-[#E6EDF3] shadow-md flex items-center justify-center text-[#768390] hover:text-[#0A66C2] transition-colors z-10"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={goToNext}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-[#E6EDF3] shadow-md flex items-center justify-center text-[#768390] hover:text-[#0A66C2] transition-colors z-10"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
        </div>

        {/* Dot indicators */}
        {slides.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === currentIndex ? 'bg-[#0A66C2]' : 'bg-[#BDBDBD]'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Icons */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#E6EDF3]">
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <ThumbsUp size={20} />
          <span className="text-[12px] font-inter">{labels.like}</span>
        </button>
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <MessageCircle size={20} />
          <span className="text-[12px] font-inter">{labels.comment}</span>
        </button>
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <Repeat2 size={20} />
          <span className="text-[12px] font-inter">{labels.repost}</span>
        </button>
        <button className="flex items-center gap-1.5 text-[#768390] hover:text-[#0A66C2] transition-colors">
          <Send size={20} />
          <span className="text-[12px] font-inter">{labels.send}</span>
        </button>
      </div>

      {/* Engagement Bar */}
      <div className="bg-[#F3F2EF] px-4 py-2.5">
        <p className="text-[12px] text-[#768390] font-inter">
          5 {labels.reactions} · 12 {labels.comments}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

interface GeneratePostTabProps {
  articles: NewsArticle[];
  selectedArticleId: string | null;
  onBackToNewsFeed: () => void;
  /* The company has a Claude or OpenAI key configured server-side. */
  aiAvailable: boolean;
  /* Company-stack matches, for the "Only my stack" filter of the picker. */
  stack: StackFilterSource;
}

export default function GeneratePostTab({ articles, selectedArticleId: propArticleId, onBackToNewsFeed, aiAvailable, stack }: GeneratePostTabProps) {
  /* NOTE: every hook below must run on each render. The "no articles" guard
     lives just above the main return, after the last hook — putting it here
     would change the hook count when articles load and crash React. */
  const hasArticles = Boolean(articles && articles.length > 0);

  /* State */
  const [selectedArticleId, setSelectedArticleId] = useState<string>(propArticleId ?? articles[0]?.id ?? '');
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>(articles.slice(0, 5).map((a) => a.id));
  const [tone, setTone] = useState<Tone>('Professional');
  const [format, setFormat] = useState<Format>('News Analysis');
  const [length, setLength] = useState<Length>('medium');
  /* Post language starts as the interface language; the user can change it. */
  const [language, setLanguage] = useState<Language>(getLang());
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiFallback, setAiFallback] = useState(false);
  const [toast, setToast] = useState<Toast>({ message: '', type: 'success', visible: false });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* Sync selected article from News Feed */
  useEffect(() => {
    if (propArticleId && articles.some((a) => a.id === propArticleId)) {
      setSelectedArticleId(propArticleId);
    }
  }, [propArticleId, articles]);

  /* Sync articles for Daily Digest when articles change */
  useEffect(() => {
    setSelectedArticleIds((prev) => {
      const valid = prev.filter((id) => articles.some((a) => a.id === id));
      if (valid.length === 0) return articles.slice(0, 5).map((a) => a.id);
      return valid;
    });
  }, [articles]);

  const selectedArticle = articles.find((a) => a.id === selectedArticleId) ?? articles[0];
  const isDailyDigest = format === 'Daily Digest';
  const isThread = format === 'Thread';
  const labels = getLabels(language);

  /* Toast helper */
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type, visible: true });
  }, []);

  const dismissToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  /* Generate */
  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    setHasGenerated(false);
    setGeneratedContent('');
    setAiFallback(false);

    const runLocal = () => {
      let post: string;
      if (isDailyDigest) {
        const digestArticles = articles.filter((a) => selectedArticleIds.includes(a.id));
        post = generateDailyDigestPost(digestArticles, tone, length, language);
      } else {
        post = generateMockPost(selectedArticle, tone, format as Exclude<Format, 'Daily Digest'>, length, language);
      }
      setGeneratedContent(post);
      setIsGenerating(false);
      setHasGenerated(true);
      showToast(language === 'es' ? 'Publicación generada (plantillas locales)' : 'Post generated from local templates');
    };

    const tryAi = async () => {
      if (isDailyDigest) return false;

      if (!aiAvailable) return false;

      try {
        const params: GenerateAiPostParams = {
          title: selectedArticle.title,
          summary: selectedArticle.summary,
          source: selectedArticle.source,
          category: selectedArticle.category,
          severity: selectedArticle.severity,
          url: selectedArticle.url,
          tone,
          format,
          length,
          language,
        };

        const post = await generateAiPost(params);
        setGeneratedContent(post);
        setIsGenerating(false);
        setHasGenerated(true);
        showToast(language === 'es' ? 'Publicación generada con IA' : 'AI post generated');
        return true;
      } catch {
        setAiFallback(true);
        return false;
      }
    };

    void tryAi().then((success) => {
      if (!success) {
        runLocal();
      }
    });
  }, [selectedArticle, tone, format, length, language, showToast, isDailyDigest, selectedArticleIds, aiAvailable]);

  /* Regenerate */
  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  /* Copy - with rich text formatting for LinkedIn */
  const handleCopy = useCallback(async () => {
    if (!generatedContent) return;
    try {
      // Convert **bold** to <strong>bold</strong> for rich text pasting
      const htmlContent = generatedContent
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br/>');

      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const textBlob = new Blob([generatedContent.replace(/\*\*(.+?)\*\*/g, '$1')], { type: 'text/plain' });

      const item = new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      });

      await navigator.clipboard.write([item]);
      setCopied(true);
      showToast(language === 'es' ? 'Copiado con formato' : 'Copied with formatting');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: copy plain text only
      try {
        await navigator.clipboard.writeText(generatedContent);
        setCopied(true);
        showToast(language === 'es' ? 'Copiado (sin formato)' : 'Copied (plain text)');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        showToast(language === 'es' ? 'Error al copiar' : 'Failed to copy', 'error');
      }
    }
  }, [generatedContent, showToast, language]);

  /* Save */
  const handleSave = useCallback(() => {
    if (!generatedContent) return;
    const title = generatedContent.split('\n')[0].slice(0, 100);

    const sourceTitle = isDailyDigest
      ? `${selectedArticleIds.length} articles — Daily Digest`
      : selectedArticle.title;
    const sourceUrl = isDailyDigest
      ? ''
      : selectedArticle.url;

    const post: SavedPost = {
      id: crypto.randomUUID(),
      title,
      content: generatedContent,
      sourceArticleTitle: sourceTitle,
      sourceArticleUrl: sourceUrl,
      tone,
      format,
      length,
      createdAt: new Date().toISOString(),
    };

    try {
      const existing = JSON.parse(localStorage.getItem('cyberpulse_history') || '[]') as SavedPost[];
      existing.unshift(post);
      localStorage.setItem('cyberpulse_history', JSON.stringify(existing));
      showToast(language === 'es' ? 'Publicación guardada' : 'Post saved');
    } catch {
      showToast(language === 'es' ? 'Error al guardar' : 'Failed to save', 'error');
    }
  }, [generatedContent, selectedArticle, tone, format, length, showToast, isDailyDigest, selectedArticleIds, language]);

  /* Section header style */
  const SectionHeader = ({ label }: { label: string }) => (
    <h3 className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mb-4">
      {label}
    </h3>
  );

  /* Guard: no articles. Placed after every hook so the hook order is stable. */
  if (!hasArticles || !selectedArticle) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-text-secondary text-sm font-inter font-medium">
          {tr("No articles available. Go back to News Feed to load articles.")}
        </p>
        <button
          onClick={onBackToNewsFeed}
          className="px-4 py-2 bg-accent text-[#0D1117] font-inter text-sm font-semibold rounded-button hover:brightness-110 transition-all cursor-pointer"
        >
          {tr("Go to News Feed")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full gap-0">
      <ToastNotification toast={toast} onDismiss={dismissToast} />

      {/* ============ LEFT COLUMN ============ */}
      <div className="w-full lg:w-1/2 lg:border-r border-[#2A3140] pr-0 lg:pr-6 pb-6 lg:pb-0 overflow-y-auto">
        <SectionHeader label={labels.sourceArticle} />

        {/* Source article picker: searchable + filterable (single or digest) */}
        {!isDailyDigest ? (
          <ArticlePicker mode="single" articles={articles} stack={stack} selectedId={selectedArticleId} onSelect={setSelectedArticleId} />
        ) : (
          <ArticlePicker mode="multi" articles={articles} stack={stack} selectedIds={selectedArticleIds} onChange={setSelectedArticleIds} />
        )}

        {/* Article Preview Card (single article mode only) */}
        {!isDailyDigest && (
          <motion.div
            key={selectedArticle.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] as [number, number, number, number] }}
            className="bg-[#161B22] border border-[#2A3140] rounded-xl p-5"
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${severityColor(selectedArticle.severity)}`} />
                <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B]">
                  {selectedArticle.source}
                </span>
              </div>
              <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B]">
                {timeAgo(selectedArticle.publishedAt)}
              </span>
            </div>

            {/* Title */}
            <h2 className="text-[18px] font-semibold font-inter text-[#E6EDF3] leading-[1.3] mb-3">
              {selectedArticle.title}
            </h2>

            {/* Summary */}
            <p className="text-[14px] font-inter text-[#8B949E] leading-[1.5] mb-4">
              {selectedArticle.summary}
            </p>

            {/* Footer row */}
            <div className="flex items-center justify-between">
              <span className="inline-block px-2 py-1 text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#E8533F] bg-[rgba(232, 83, 63,0.1)] rounded-pill">
                {selectedArticle.category}
              </span>
              <div className="flex items-center gap-1.5 text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B]">
                <FileText size={12} />
                {selectedArticle.readTime}
              </div>
            </div>
          </motion.div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="ghost"
            className="text-[#E8533F] hover:bg-[rgba(232, 83, 63,0.1)] font-inter text-sm font-medium px-4 py-2 h-auto rounded-button cursor-pointer"
            onClick={onBackToNewsFeed}
          >
            <ArrowLeft size={16} />
            {labels.backToNews}
          </Button>
          {!isDailyDigest && (
            /* A real anchor rather than window.open: middle-click and "copy
               link address" work, and the article — which comes from a
               third-party feed — never gets a handle on window.opener. */
            <Button
              asChild
              variant="outline"
              className="border-[#2A3140] text-[#E6EDF3] hover:bg-[#1A1F2E] hover:border-[#8B949E] font-inter text-sm font-medium px-4 py-2 h-auto rounded-button bg-transparent"
            >
              <a href={selectedArticle.url} target="_blank" rel="noopener noreferrer">
                {labels.openOriginal}
                <ExternalLink size={16} />
              </a>
            </Button>
          )}
          {isDailyDigest && (
            <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B]">
              {selectedArticleIds.length} {labels.articlesWillBeIncluded}
            </span>
          )}
        </div>
      </div>

      {/* ============ RIGHT COLUMN ============ */}
      <div className="w-full lg:w-1/2 pl-0 lg:pl-6 pt-6 lg:pt-0 overflow-y-auto">
        <SectionHeader label={labels.generatePost} />

        {/* Configuration Panel */}
        <div className="bg-[#161B22] border border-[#2A3140] rounded-xl p-5 mb-4">
          {/* Language Selector */}
          <div className="mb-4">
            <label className="block text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mb-2">
              {labels.language}
            </label>
            <RadioGroup
              value={language}
              onValueChange={(v) => setLanguage(v as Language)}
              className="flex items-center gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="en"
                  id="lang-en"
                  className="border-[#2A3140] text-[#E8533F] data-[state=checked]:border-[#E8533F]"
                />
                <label
                  htmlFor="lang-en"
                  className={`text-[13px] font-inter cursor-pointer ${
                    language === 'en' ? 'text-[#E6EDF3]' : 'text-[#8B949E]'
                  }`}
                >
                  {tr("🇬🇧 English")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="es"
                  id="lang-es"
                  className="border-[#2A3140] text-[#E8533F] data-[state=checked]:border-[#E8533F]"
                />
                <label
                  htmlFor="lang-es"
                  className={`text-[13px] font-inter cursor-pointer ${
                    language === 'es' ? 'text-[#E6EDF3]' : 'text-[#8B949E]'
                  }`}
                >
                  {tr("🇪🇸 Español")}
                </label>
              </div>
            </RadioGroup>
          </div>

          {/* Tone Selector */}
          <div className="mb-4">
            <label className="block text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mb-2">
              {labels.tone}
            </label>
            <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
              <SelectTrigger className="w-full bg-[#1A1F2E] border-[#2A3140] text-[#E6EDF3] font-inter text-sm rounded-lg h-10 hover:border-[#636E7B] transition-colors [&>svg]:text-[#636E7B]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1A1F2E] border-[#2A3140] rounded-lg">
                {(['Professional', 'Casual', 'Urgent', 'Educational', 'Thought Leadership'] as Tone[]).map((t) => (
                  <SelectItem
                    key={t}
                    value={t}
                    className="text-[#E6EDF3] font-inter text-sm focus:bg-[rgba(232, 83, 63,0.1)] focus:text-[#E6EDF3] cursor-pointer"
                  >
                    {tr(toneLabel(t))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Format Selector */}
          <div className="mb-4">
            <label className="block text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mb-2">
              {labels.format}
            </label>
            <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
              <SelectTrigger className="w-full bg-[#1A1F2E] border-[#2A3140] text-[#E6EDF3] font-inter text-sm rounded-lg h-10 hover:border-[#636E7B] transition-colors [&>svg]:text-[#636E7B]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1A1F2E] border-[#2A3140] rounded-lg">
                {(['News Analysis', 'Quick Summary', 'Thread', 'Contrarian', 'Storytelling', 'Daily Digest'] as Format[]).map((f) => (
                  <SelectItem
                    key={f}
                    value={f}
                    className="text-[#E6EDF3] font-inter text-sm focus:bg-[rgba(232, 83, 63,0.1)] focus:text-[#E6EDF3] cursor-pointer"
                  >
                    {tr(f === 'Thread' ? 'Thread / Carousel' : f === 'Contrarian' ? 'Contrarian Take' : f)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Length Selector */}
          <div className="mb-5">
            <label className="block text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mb-2">
              {labels.length}
            </label>
            <RadioGroup
              value={length}
              onValueChange={(v) => setLength(v as Length)}
              className="flex items-center gap-4"
            >
              {(['short', 'medium', 'long'] as Length[]).map((l) => (
                <div key={l} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={l}
                    id={`length-${l}`}
                    className="border-[#2A3140] text-[#E8533F] data-[state=checked]:border-[#E8533F]"
                  />
                  <label
                    htmlFor={`length-${l}`}
                    className={`text-[13px] font-inter cursor-pointer ${
                      length === l ? 'text-[#E6EDF3]' : 'text-[#8B949E]'
                    }`}
                  >
                    {l === 'short' ? labels.short : l === 'medium' ? labels.medium : labels.long}{' '}
                    <span className="text-[#636E7B]">({lengthWordCount(l)})</span>
                  </label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Generate Button */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`
              w-full flex items-center justify-center gap-2 py-2.5 px-5 rounded-button
              font-inter text-sm font-semibold
              transition-all duration-200
              ${isGenerating
                ? 'bg-[#E8533F]/70 text-[#0D1117] cursor-not-allowed'
                : 'bg-[#E8533F] text-[#0D1117] hover:brightness-110 hover:scale-[1.02] cursor-pointer'
              }
            `}
          >
            {isGenerating ? (
              <>
                <span className="w-4 h-4 border-2 border-transparent border-t-[#0D1117] rounded-full animate-spin" />
                {labels.generating}
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {labels.generateBtn}
              </>
            )}
          </motion.button>
        </div>

        {/* ============ GENERATED POST EDITOR ============ */}
        <AnimatePresence>
          {hasGenerated && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] as [number, number, number, number], delay: 0.1 }}
            >
              <SectionHeader label={labels.editPost} />

              {aiFallback && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-3 py-2">
                  <AlertCircle size={14} className="text-accent shrink-0" />
                  <span className="text-xs font-inter text-text-secondary">
                    {tr("AI unavailable — using local templates")}
                  </span>
                </div>
              )}

              <Textarea
                ref={textareaRef}
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
                className="min-h-[300px] bg-[#1A1F2E] border-[#2A3140] rounded-lg p-4 font-merriweather text-[16px] text-[#E6EDF3] leading-[1.7] resize-y focus:border-[#E8533F] focus:shadow-[0_0_0_2px_rgba(232, 83, 63,0.15)] transition-all"
              />

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <Button
                  variant="ghost"
                  onClick={handleRegenerate}
                  className="text-[#E8533F] hover:bg-[rgba(232, 83, 63,0.1)] font-inter text-sm font-medium flex-1 rounded-button h-10"
                >
                  <RefreshCw size={16} />
                  {labels.regenerate}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCopy}
                  className="border-[#2A3140] text-[#E6EDF3] hover:bg-[#1A1F2E] hover:border-[#8B949E] font-inter text-sm font-medium flex-1 rounded-button h-10 bg-transparent"
                >
                  <ClipboardCopy size={16} />
                  {copied ? labels.copied : labels.copy}
                </Button>
                <Button
                  onClick={handleSave}
                  className="bg-[#E8533F] text-[#0D1117] hover:brightness-110 font-inter text-sm font-semibold flex-1 rounded-button h-10"
                >
                  <Save size={16} />
                  {labels.save}
                </Button>
                <LinkedInPublishButton content={generatedContent} className="font-inter text-sm font-semibold flex-1 rounded-button h-10" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ============ LINKEDIN / CAROUSEL PREVIEW ============ */}
        <AnimatePresence>
          {hasGenerated && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] as [number, number, number, number], delay: 0.2 }}
              className="mt-6"
            >
              <SectionHeader label={isThread ? labels.carouselPreview : labels.linkedinPreview} />
              {isThread ? (
                <CarouselPreview content={generatedContent} lang={language} />
              ) : (
                <LinkedInPreview content={generatedContent} lang={language} />
              )}

              {/* Schedule Panel */}
              <LinkedInSchedulePanel content={generatedContent} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}

/* The chunk only evaluates when this tab is opened, which is exactly when
   the post font becomes visible. */
loadPostFont();
