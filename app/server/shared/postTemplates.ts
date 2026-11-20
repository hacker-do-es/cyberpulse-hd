/* Post templates shared by the browser (Generate Post) and the server
   (scheduled LinkedIn channel), so both write exactly the same posts.
   Pure functions only: no React, no DOM, no Node APIs. */

export type Language = 'en' | 'es';
export type Tone = 'Professional' | 'Casual' | 'Urgent' | 'Educational' | 'Thought Leadership';
export type Format = 'News Analysis' | 'Quick Summary' | 'Thread' | 'Contrarian' | 'Storytelling' | 'Daily Digest';
export type Length = 'short' | 'medium' | 'long';

export const TONES: Tone[] = ['Professional', 'Casual', 'Urgent', 'Educational', 'Thought Leadership'];
export const FORMATS: Format[] = ['News Analysis', 'Quick Summary', 'Thread', 'Contrarian', 'Storytelling', 'Daily Digest'];
export const LENGTHS: Length[] = ['short', 'medium', 'long'];

/* The fields of an article the templates use. */
export interface NewsArticle {
  title: string;
  summary: string;
  url: string;
  severity: string;
  category: string;
}

/* ------------------------------------------------------------------ */
/*  Mock post generation                                               */
/* ------------------------------------------------------------------ */

export function generateMockPost(
  article: NewsArticle,
  tone: Tone,
  format: Exclude<Format, 'Daily Digest'>,
  length: Length,
  lang: Language
): string {
  const wordCount =
    length === 'short' ? 'short' : length === 'medium' ? 'medium' : 'long';

  const templates: Record<Exclude<Format, 'Daily Digest'>, (a: NewsArticle, t: Tone, wc: string, lang: Language) => string> = {
    'News Analysis': newsAnalysisTemplate,
    'Quick Summary': quickSummaryTemplate,
    'Thread': threadTemplate,
    'Contrarian': contrarianTemplate,
    'Storytelling': storytellingTemplate,
  };

  const post = templates[format](article, tone, wordCount, lang);
  const sourceLine =
    lang === 'es'
      ? `🔗 Lee la historia completa: ${article.url}`
      : `🔗 Read the full story: ${article.url}`;
  return `${post}\n\n${sourceLine}`;
}

function baseTone(tone: Tone, sentence: string, lang: Language): string {
  if (lang === 'es') {
    // Spanish tone adjustments - only on complete words
    if (tone === 'Casual') return sentence.replace(/\bestá utilizando\b/g, 'está usando').replace(/\borganizaciones\b/g, 'empresas').replace(/\bimplementar\b/g, 'poner en marcha');
    if (tone === 'Urgent') return sentence.replace(/\bdebería\b/g, 'debe').replace(/\bimportante\b/g, 'crítico');
    if (tone === 'Educational') return sentence;
    if (tone === 'Thought Leadership') return sentence.replace(/\bes un\b/g, 'representa un').replace(/\batacantes\b/g, 'actores de amenazas');
    return sentence;
  }

  // English tone adjustments - only on complete words
  if (tone === 'Casual') return sentence.replace(/\bis utilizing\b/g, 'is using').replace(/\borganizations\b/g, 'companies').replace(/\bimplement\b/g, 'put in place').replace(/\bimmediately\b/g, 'ASAP');
  if (tone === 'Urgent') return sentence.replace(/\bshould\b/g, 'must').replace(/\bimportant\b/g, 'critical').replace(/\bconsider\b/g, 'act now to');
  if (tone === 'Educational') return sentence;
  if (tone === 'Thought Leadership') return sentence.replace(/\bis a\b/g, 'represents a').replace(/\battackers\b/g, 'threat actors');
  return sentence;
}

function hashtags(article: NewsArticle, lang: Language): string {
  if (lang === 'es') {
    const categoryTags: Record<string, string> = {
      'RANSOMWARE': '#ransomware #infraestructuracritica',
      'VULNERABILITY': '#vulnerabilidad #gestiondeparches',
      'DATA BREACH': '#filtraciondedatos #sanidad #privacidad',
      'THREAT INTEL': '#inteligenciadeamenazas #APT #cadenadesuministro',
      'COMPLIANCE': '#cumplimiento #NIS2 #regulacion',
      'MALWARE': '#malware #botnet #DDoS',
      'PHISHING': '#phishing #MFA #ingenieriasocial',
      'RESEARCH': '#ciberseguridad #investigacion #postcuantica',
      'POLICY': '#politica #gobernanza #regulacion',
      'PRIVACY': '#privacidad #protecciondedatos #GDPR',
      'ALERT': '#alertadeseguridad #infoseguridad #ciberseguridad',
      'EXPLOIT': '#exploit #zeroday #vulnerabilidad',
      'IOT': '#IoT #seguridadembebida #infraestructuracritica',
      'INDUSTRY': '#industriaciberseguridad #tendencias #estrategia',
      'AWARENESS': '#concientizacion #factorhumano #capacitacion',
      'SUPPLY CHAIN': '#cadenadesuministro #terceros #gestionderiesgos',
      'AI SECURITY': '#seguridadIA #InteligenciaArtificial #aprendizajeautomatico',
    };
    const specific = categoryTags[article.category] || '#ciberseguridad';
    return `${specific} #ciberseguridad #infoseguridad`;
  }

  const categoryTags: Record<string, string> = {
    'RANSOMWARE': '#ransomware #criticalinfrastructure',
    'VULNERABILITY': '#vulnerability #patchmanagement',
    'DATA BREACH': '#databreach #healthcare #privacy',
    'THREAT INTEL': '#threatintel #APT #supplychain',
    'COMPLIANCE': '#compliance #NIS2 #regulation',
    'MALWARE': '#malware #botnet #DDoS',
    'PHISHING': '#phishing #MFA #socialengineering',
    'RESEARCH': '#cybersecurity #research #postquantum',
    'POLICY': '#policy #governance #regulation',
    'PRIVACY': '#privacy #dataprotection #GDPR',
    'ALERT': '#securityalert #infosec #cybersecurity',
    'EXPLOIT': '#exploit #zeroday #vulnerability',
    'IOT': '#IoT #embeddedsecurity #criticalinfrastructure',
    'INDUSTRY': '#cybersecurityindustry #trends #strategy',
    'AWARENESS': '#securityawareness #humanfactor #training',
    'SUPPLY CHAIN': '#supplychain #thirdparty #riskmanagement',
    'AI SECURITY': '#AIsecurity #ArtificialIntelligence #machinelearning',
  };
  const specific = categoryTags[article.category] || '#cybersecurity';
  return `${specific} #infosec #cybersecurity`;
}

interface CategoryContext {
  topic: string;
  incident: string;
  advice: { short: string; medium: string; long: string };
  question: string;
}

function categoryContext(category: string, lang: Language): CategoryContext {
  const fallbackEn: CategoryContext = {
    topic: 'security developments',
    incident: 'a security development',
    advice: {
      short: 'assess relevance and identify your next step',
      medium: 'assess relevance, assign ownership, and track outcomes',
      long: 'assess relevance, assign ownership, track outcomes, and update your security roadmap',
    },
    question: 'How does this fit into your security priorities?',
  };

  const fallbackEs: CategoryContext = {
    topic: 'novedades de seguridad',
    incident: 'una novedad de seguridad',
    advice: {
      short: 'evalúa la relevancia e identifica tu próximo paso',
      medium: 'evalúa la relevancia, asigna responsables y da seguimiento a los resultados',
      long: 'evalúa la relevancia, asigna responsables, da seguimiento a los resultados y actualiza tu hoja de ruta de seguridad',
    },
    question: '¿Cómo encaja esto en tus prioridades de seguridad?',
  };

  if (lang === 'es') {
    const contexts: Record<string, CategoryContext> = {
      'RANSOMWARE': {
        topic: 'ataques de ransomware',
        incident: 'un ataque de ransomware',
        advice: {
          short: 'aísla los sistemas afectados y verifica las copias de seguridad',
          medium: 'aísla los sistemas afectados, verifica la integridad de las copias de seguridad y alerta a tu equipo de respuesta a incidentes',
          long: 'aísla los sistemas afectados, verifica la integridad de las copias de seguridad, moviliza a tu equipo de respuesta a incidentes y revisa los planes de continuidad del negocio',
        },
        question: '¿Cómo estás fortaleciendo tu capacidad de recuperación ante ransomware?',
      },
      'VULNERABILITY': {
        topic: 'vulnerabilidades de software',
        incident: 'una vulnerabilidad recién divulgada',
        advice: {
          short: 'verifica la exposición y prioriza los parches',
          medium: 'evalúa la exposición, prioriza los parches y prueba controles compensatorios',
          long: 'evalúa la exposición en todo tu entorno, prioriza los parches, prueba controles compensatorios y comunica los plazos a los interesados',
        },
        question: '¿Cuál es tu mayor desafío en la gestión de parches?',
      },
      'DATA BREACH': {
        topic: 'filtraciones de datos',
        incident: 'una filtración de datos',
        advice: {
          short: 'confirma el alcance y notifica a los afectados',
          medium: 'confirma el alcance, preserva las evidencias y notifica a los afectados según la normativa',
          long: 'confirma el alcance, preserva las evidencias, notifica a los afectados y reguladores, y revisa las políticas de retención de datos',
        },
        question: '¿Qué controles habrían dificultado esta filtración?',
      },
      'THREAT INTEL': {
        topic: 'hallazgos de inteligencia de amenazas',
        incident: 'una campaña de actores de amenazas',
        advice: {
          short: 'compara los IOC con tu telemetría',
          medium: 'compara los IOC con tu telemetría, actualiza las detecciones y informa a los analistas',
          long: 'compara los IOC con tu telemetría, actualiza las reglas de detección, informa a los analistas y comparte ideas relevantes con aliados',
        },
        question: '¿Cómo conviertes la inteligencia de amenazas en acción?',
      },
      'COMPLIANCE': {
        topic: 'novedades regulatorias',
        incident: 'un requisito normativo',
        advice: {
          short: 'mapea el requisito con tus controles',
          medium: 'mapea el requisito con tus controles, identifica brechas y asigna responsables',
          long: 'mapea el requisito con tus controles, identifica brechas, asigna responsables y construye una hoja de ruta de remediación',
        },
        question: '¿Qué obligación de cumplimiento te mantiene más ocupado?',
      },
      'MALWARE': {
        topic: 'hallazgos de malware',
        incident: 'una infección de malware',
        advice: {
          short: 'contiene el equipo y busca persistencia',
          medium: 'contiene los equipos afectados, busca persistencia y restablece las credenciales',
          long: 'contiene los equipos afectados, busca persistencia, restablece las credenciales comprometidas y mejora los controles de ejecución',
        },
        question: '¿Cuál es tu señal de detección de malware más confiable?',
      },
      'PHISHING': {
        topic: 'campañas de phishing',
        incident: 'un intento de phishing',
        advice: {
          short: 'repórtalo y verifica las credenciales',
          medium: 'repórtalo, verifica que no se hayan comprometido credenciales y refuerza la capacitación',
          long: 'repórtalo, verifica las credenciales, refuerza la capacitación de usuarios y revisa los controles de seguridad del correo',
        },
        question: '¿Los usuarios saben cómo reportar phishing en tu organización?',
      },
      'RESEARCH': {
        topic: 'investigación en seguridad',
        incident: 'un hallazgo de investigación',
        advice: {
          short: 'revisa las implicaciones para tu entorno',
          medium: 'revisa las implicaciones, prueba los riesgos de la prueba de concepto y comparte con ingeniería',
          long: 'revisa las implicaciones para tu entorno, prueba los riesgos de la prueba de concepto, comparte con ingeniería y planifica mitigaciones',
        },
        question: '¿Cómo te mantienes al día con la investigación emergente?',
      },
      'POLICY': {
        topic: 'novedades políticas',
        incident: 'un cambio regulatorio',
        advice: {
          short: 'evalúa el impacto en tu gobernanza',
          medium: 'evalúa el impacto en la gobernanza, actualiza las políticas y comunícalas a los equipos',
          long: 'evalúa el impacto en la gobernanza, actualiza las políticas, comunícalas a los equipos y alinea los controles con los nuevos requisitos',
        },
        question: '¿Qué área de políticas necesita más atención en tu organización?',
      },
      'PRIVACY': {
        topic: 'prácticas de privacidad',
        incident: 'una preocupación de privacidad',
        advice: {
          short: 'revisa el manejo de datos y el consentimiento',
          medium: 'revisa el manejo de datos, los mecanismos de consentimiento y los procesos de derechos de los usuarios',
          long: 'revisa el manejo de datos, los mecanismos de consentimiento, los procesos de derechos de los usuarios y los acuerdos de compartición con terceros',
        },
        question: '¿Cómo equilibras la personalización con la privacidad?',
      },
      'ALERT': {
        topic: 'alertas de seguridad',
        incident: 'una alerta de seguridad',
        advice: {
          short: 'evalúa la gravedad y el alcance',
          medium: 'evalúa la gravedad, confirma el alcance y sigue las recomendaciones del proveedor',
          long: 'evalúa la gravedad, confirma el alcance, sigue las recomendaciones del proveedor y documenta las acciones de respuesta',
        },
        question: '¿Cómo evitas la fatiga de alertas?',
      },
      'EXPLOIT': {
        topic: 'actividad de explotación',
        incident: 'un exploit activo',
        advice: {
          short: 'verifica la exposición y aplica mitigaciones',
          medium: 'verifica la exposición, aplica mitigaciones y busca indicadores',
          long: 'verifica la exposición, aplica mitigaciones, busca indicadores y refina la cobertura de detección',
        },
        question: '¿Cuál es tu tiempo medio para mitigar un exploit conocido?',
      },
      'IOT': {
        topic: 'problemas de seguridad en IoT',
        incident: 'un problema de seguridad en IoT',
        advice: {
          short: 'inventaría los dispositivos y cambia las credenciales por defecto',
          medium: 'inventaría los dispositivos conectados, cambia las credenciales por defecto y segmenta la red',
          long: 'inventaría los dispositivos conectados, cambia las credenciales por defecto, segmenta la red y monitorea comportamientos anómalos',
        },
        question: '¿Cómo aseguras los dispositivos que no controlas del todo?',
      },
      'INDUSTRY': {
        topic: 'tendencias del sector',
        incident: 'un desarrollo del sector',
        advice: {
          short: 'evalúa la relevancia estratégica',
          medium: 'evalúa la relevancia estratégica, compara con los referentes del sector e informa a la dirección',
          long: 'evalúa la relevancia estratégica, compara con los referentes del sector, informa a la dirección y ajusta tu hoja de ruta',
        },
        question: '¿Qué cambio del sector reconfigurará tus prioridades?',
      },
      'AWARENESS': {
        topic: 'temas de concientización',
        incident: 'un momento de concientización',
        advice: {
          short: 'comparte un consejo práctico',
          medium: 'comparte consejos prácticos, lanza una campaña breve y mide la participación',
          long: 'comparte consejos prácticos, lanza campañas de concientización, mide la participación y refuerza los comportamientos con el tiempo',
        },
        question: '¿Qué hábito de seguridad cambió tu comportamiento?',
      },
      'SUPPLY CHAIN': {
        topic: 'riesgos de la cadena de suministro',
        incident: 'un riesgo en la cadena de suministro',
        advice: {
          short: 'revisa el acceso de proveedores y los inventarios de software',
          medium: 'revisa el acceso de proveedores, valida las SBOM y endurece las revisiones de adquisiciones',
          long: 'revisa el acceso de proveedores, valida las SBOM, endurece las revisiones de adquisiciones y monitorea los impactos downstream',
        },
        question: '¿Qué tan bien conoces a tus proveedores críticos?',
      },
      'AI SECURITY': {
        topic: 'consideraciones de seguridad en IA',
        incident: 'un desarrollo en seguridad de IA',
        advice: {
          short: 'revisa el uso de IA y sus salvaguardas',
          medium: 'revisa el uso de IA, la gobernanza de modelos y la validación de salidas',
          long: 'revisa el uso de IA, la gobernanza de modelos, la validación de salidas y los controles de fugas de datos',
        },
        question: '¿Qué riesgo de IA estás monitoreando más de cerca?',
      },
    };
    return contexts[category] ?? fallbackEs;
  }

  const contexts: Record<string, CategoryContext> = {
    'RANSOMWARE': {
      topic: 'ransomware attacks',
      incident: 'a ransomware attack',
      advice: {
        short: 'isolate affected systems and verify backups',
        medium: 'isolate affected systems, verify backup integrity, and alert your incident response team',
        long: 'isolate affected systems, verify backup integrity, engage your incident response team, and review business continuity plans',
      },
      question: 'How are you hardening your recovery posture against ransomware?',
    },
    'VULNERABILITY': {
      topic: 'software vulnerabilities',
      incident: 'a newly disclosed vulnerability',
      advice: {
        short: 'check exposure and prioritize patches',
        medium: 'assess exposure, prioritize patches, and test compensating controls',
        long: 'assess exposure across your estate, prioritize patches, test compensating controls, and communicate timelines to stakeholders',
      },
      question: 'What is your biggest patch-management challenge right now?',
    },
    'DATA BREACH': {
      topic: 'data breaches',
      incident: 'a data breach',
      advice: {
        short: 'confirm scope and notify affected parties',
        medium: 'confirm scope, secure evidence, and notify affected parties per regulations',
        long: 'confirm scope, preserve evidence, notify affected parties and regulators, and review data retention policies',
      },
      question: 'What controls would have made this breach harder?',
    },
    'THREAT INTEL': {
      topic: 'threat intelligence findings',
      incident: 'a threat actor campaign',
      advice: {
        short: 'compare IOCs with your telemetry',
        medium: 'compare IOCs against your telemetry, update detections, and brief analysts',
        long: 'compare IOCs against your telemetry, update detection rules, brief your analysts, and share relevant insights with partners',
      },
      question: 'How do you turn threat intel into action?',
    },
    'COMPLIANCE': {
      topic: 'compliance developments',
      incident: 'a regulatory requirement',
      advice: {
        short: 'map the requirement to your controls',
        medium: 'map the requirement to your controls, identify gaps, and assign owners',
        long: 'map the requirement to your controls, identify gaps, assign owners, and build a remediation roadmap',
      },
      question: 'Which compliance obligation keeps you busiest?',
    },
    'MALWARE': {
      topic: 'malware findings',
      incident: 'a malware infection',
      advice: {
        short: 'contain the host and hunt for persistence',
        medium: 'contain affected hosts, hunt for persistence, and reset credentials',
        long: 'contain affected hosts, hunt for persistence, reset compromised credentials, and improve execution controls',
      },
      question: 'What is your most reliable malware detection signal?',
    },
    'PHISHING': {
      topic: 'phishing campaigns',
      incident: 'a phishing attempt',
      advice: {
        short: 'report it and verify credentials',
        medium: 'report the attempt, verify no credentials were compromised, and reinforce training',
        long: 'report the attempt, verify credentials, reinforce user training, and review email security controls',
      },
      question: 'Do users know how to report phishing in your org?',
    },
    'RESEARCH': {
      topic: 'security research',
      incident: 'a research finding',
      advice: {
        short: 'review the implications for your stack',
        medium: 'review the implications, test proof-of-concept risks, and share with engineering',
        long: 'review implications for your stack, test proof-of-concept risks, share with engineering, and plan mitigations',
      },
      question: 'How do you stay current with emerging research?',
    },
    'POLICY': {
      topic: 'policy developments',
      incident: 'a policy change',
      advice: {
        short: 'assess impact on your governance',
        medium: 'assess impact on governance, update policies, and communicate to teams',
        long: 'assess impact on governance, update policies, communicate to teams, and align controls with new requirements',
      },
      question: 'What policy area needs the most attention in your organization?',
    },
    'PRIVACY': {
      topic: 'privacy practices',
      incident: 'a privacy concern',
      advice: {
        short: 'review data handling and consent',
        medium: 'review data handling, consent mechanisms, and user rights processes',
        long: 'review data handling, consent mechanisms, user rights processes, and third-party sharing agreements',
      },
      question: 'How do you balance personalization with privacy?',
    },
    'ALERT': {
      topic: 'security alerts',
      incident: 'a security advisory',
      advice: {
        short: 'triage severity and scope',
        medium: 'triage severity, confirm scope, and follow vendor guidance',
        long: 'triage severity, confirm scope, follow vendor guidance, and document response actions',
      },
      question: 'How do you avoid alert fatigue?',
    },
    'EXPLOIT': {
      topic: 'exploit activity',
      incident: 'an active exploit',
      advice: {
        short: 'check exposure and apply mitigations',
        medium: 'check exposure, apply mitigations, and hunt for indicators',
        long: 'check exposure, apply mitigations, hunt for indicators, and refine detection coverage',
      },
      question: 'What is your mean time to mitigate a known exploit?',
    },
    'IOT': {
      topic: 'IoT security issues',
      incident: 'an IoT security issue',
      advice: {
        short: 'inventory devices and change defaults',
        medium: 'inventory connected devices, change default credentials, and segment the network',
        long: 'inventory connected devices, change default credentials, segment the network, and monitor for anomalous behavior',
      },
      question: 'How do you secure devices you don\'t fully control?',
    },
    'INDUSTRY': {
      topic: 'industry trends',
      incident: 'an industry development',
      advice: {
        short: 'evaluate strategic relevance',
        medium: 'evaluate strategic relevance, benchmark against peers, and brief leadership',
        long: 'evaluate strategic relevance, benchmark against peers, brief leadership, and adjust your roadmap',
      },
      question: 'What industry shift will reshape your priorities?',
    },
    'AWARENESS': {
      topic: 'awareness topics',
      incident: 'an awareness moment',
      advice: {
        short: 'share one actionable tip',
        medium: 'share actionable tips, run a quick campaign, and measure engagement',
        long: 'share actionable tips, run awareness campaigns, measure engagement, and reinforce behaviors over time',
      },
      question: 'What security habit changed your behavior?',
    },
    'SUPPLY CHAIN': {
      topic: 'supply chain risks',
      incident: 'a supply chain risk',
      advice: {
        short: 'review vendor access and software bills',
        medium: 'review vendor access, validate SBOMs, and tighten procurement checks',
        long: 'review vendor access, validate SBOMs, tighten procurement checks, and monitor for downstream impacts',
      },
      question: 'How well do you know your critical vendors?',
    },
    'AI SECURITY': {
      topic: 'AI security considerations',
      incident: 'an AI security development',
      advice: {
        short: 'review AI usage and guardrails',
        medium: 'review AI usage, model governance, and output validation',
        long: 'review AI usage, model governance, output validation, and data leakage controls',
      },
      question: 'What AI risk are you tracking most closely?',
    },
  };
  return contexts[category] ?? fallbackEn;
}

/* LinkedIn shows dashes and arrows as plain characters, so posts use no list
   markers: each point starts with an emoji that says what it is, and a post
   carries 3-6 emojis in total. */
const SEVERITY_EMOJI: Record<string, string> = { critical: '🚨', high: '⚠️', medium: '🔶', low: 'ℹ️' };
const sevEmoji = (a: NewsArticle) => SEVERITY_EMOJI[a.severity] ?? '🔎';
const POINT_EMOJI = ['🔍', '🏢', '🛡️'];
const QUICK_EMOJI = ['📰', '🎯', '✅'];
const points = (items: string[], emojis: string[]) => items.map((t, i) => `${emojis[i % emojis.length]} ${t}`).join('\n');

function newsAnalysisTemplate(a: NewsArticle, tone: Tone, wc: string, lang: Language): string {
  const ctx = categoryContext(a.category, lang);

  if (lang === 'es') {
    const intro = `${sevEmoji(a)} ` + baseTone(tone, `Un desarrollo significativo en ${ctx.topic} está causando impacto en la comunidad de seguridad.`, lang);
    const body = baseTone(tone, `${a.title}. ${a.summary}`, lang);
    const bullets = [
      `Este desarrollo pone de relieve los puntos débiles persistentes en ${ctx.topic}`,
      `Las organizaciones con enfoques heredados siguen siendo las más expuestas`,
      `Las implicaciones de este desarrollo para ${ctx.topic} subrayan la necesidad de una inversión proactiva en seguridad`,
    ];
    const takeaway = '💡 ' + baseTone(tone, `Conclusión: ${ctx.advice[wc as Length]}.`, lang);

    if (wc === 'short') {
      return `${intro}\n\n${body}\n\n${takeaway}\n\n${hashtags(a, lang)}`;
    }

    const fullBullets = points(bullets.map((b) => baseTone(tone, b, lang)), POINT_EMOJI);

    if (wc === 'medium') {
      return `${intro}\n\n${body}\n\n${fullBullets}\n\n${takeaway}\n\n${hashtags(a, lang)}`;
    }

    return `${intro}\n\n${body}\n\nObservaciones clave:\n${fullBullets}\n\n${takeaway}\n\n${ctx.question}\n\n${hashtags(a, lang)}`;
  }

  const intro = `${sevEmoji(a)} ` + baseTone(tone, `A significant development in ${ctx.topic} is making waves across the security community.`, lang);
  const body = baseTone(tone, `${a.title}. ${a.summary}`, lang);
  const bullets = [
    `This development highlights persistent weaknesses in ${ctx.topic}`,
    `Organizations with legacy approaches remain most exposed`,
    `The implications of this development for ${ctx.topic} underscore the need for proactive security investment`,
  ];
  const takeaway = '💡 ' + baseTone(tone, `The bottom line: ${ctx.advice[wc as Length]}.`, lang);

  if (wc === 'short') {
    return `${intro}\n\n${body}\n\n${takeaway}\n\n${hashtags(a, lang)}`;
  }

  const fullBullets = points(bullets.map((b) => baseTone(tone, b, lang)), POINT_EMOJI);

  if (wc === 'medium') {
    return `${intro}\n\n${body}\n\n${fullBullets}\n\n${takeaway}\n\n${hashtags(a, lang)}`;
  }

  return `${intro}\n\n${body}\n\nKey observations:\n${fullBullets}\n\n${takeaway}\n\n${ctx.question}\n\n${hashtags(a, lang)}`;
}

function quickSummaryTemplate(a: NewsArticle, tone: Tone, wc: string, lang: Language): string {
  const ctx = categoryContext(a.category, lang);

  if (lang === 'es') {
    const header = `${sevEmoji(a)} ` + (tone === 'Casual' ? `Actualización rápida sobre ${a.category.toLowerCase()}:` : `${a.category} — Actualización Rápida`);
    const bullets = [
      `Qué: ${a.title}`,
      `Impacto: ${a.summary.slice(0, 120)}...`,
      `Acción: ${ctx.advice.short}`,
    ];
    if (wc === 'short') {
      return `${header}\n\n${points(bullets.slice(0, 2), QUICK_EMOJI)}\n\n${hashtags(a, lang)}`;
    }
    if (wc === 'medium') {
      return `${header}\n\n${points(bullets, QUICK_EMOJI)}\n\n💡 Conclusión clave: ${ctx.advice.medium}.\n\n${hashtags(a, lang)}`;
    }
    return `${header}\n\n${points(bullets, QUICK_EMOJI)}\n\n💡 ${baseTone(tone, `Conclusión: ${ctx.advice.long}.`, lang)}\n\n${hashtags(a, lang)}`;
  }

  const header = `${sevEmoji(a)} ` + (tone === 'Casual' ? `Quick update on ${a.category.toLowerCase()}:` : `${a.category} — Quick Update`);
  const bullets = [
    `What: ${a.title}`,
    `Impact: ${a.summary.slice(0, 120)}...`,
    `Action: ${ctx.advice.short}`,
  ];
  if (wc === 'short') {
    return `${header}\n\n${points(bullets.slice(0, 2), QUICK_EMOJI)}\n\n${hashtags(a, lang)}`;
  }
  if (wc === 'medium') {
    return `${header}\n\n${points(bullets, QUICK_EMOJI)}\n\n💡 Key takeaway: ${ctx.advice.medium}.\n\n${hashtags(a, lang)}`;
  }
  return `${header}\n\n${points(bullets, QUICK_EMOJI)}\n\n💡 ${baseTone(tone, `Bottom line: ${ctx.advice.long}.`, lang)}\n\n${hashtags(a, lang)}`;
}

function threadTemplate(a: NewsArticle, tone: Tone, wc: string, lang: Language): string {
  const ctx = categoryContext(a.category, lang);
  const slides = wc === 'short' ? 2 : wc === 'medium' ? 3 : 4;

  const formatAdvice = (text: string) =>
    text
      .split(', ')
      .map((step) => step.replace(/^(and|y)\s+/i, ''))
      .map((step) => `✅ ${step.charAt(0).toUpperCase() + step.slice(1)}`)
      .join('\n');

  if (lang === 'es') {
    const lines: string[] = [`1️⃣ ${a.title}\n`];
    lines.push(`2️⃣ ${a.summary.slice(0, 200)}...\n`);
    if (slides >= 3) {
      lines.push(baseTone(tone, `3️⃣ ¿Qué hacer?\n${formatAdvice(ctx.advice.medium)}\n`, lang));
    }
    if (slides >= 4) {
      lines.push(`4️⃣ ${baseTone(tone, `Conclusión: ${ctx.advice.long}. ${ctx.question}`, lang)}\n`);
    }
    return lines.join('\n') + `\n${hashtags(a, lang)}`;
  }

  const lines: string[] = [`1️⃣ ${a.title}\n`];
  lines.push(`2️⃣ ${a.summary.slice(0, 200)}...\n`);
  if (slides >= 3) {
    lines.push(baseTone(tone, `3️⃣ What should you do?\n${formatAdvice(ctx.advice.medium)}\n`, lang));
  }
  if (slides >= 4) {
    lines.push(`4️⃣ ${baseTone(tone, `Bottom line: ${ctx.advice.long}. ${ctx.question}`, lang)}\n`);
  }
  return lines.join('\n') + `\n${hashtags(a, lang)}`;
}

function contrarianTemplate(a: NewsArticle, tone: Tone, wc: string, lang: Language): string {
  const ctx = categoryContext(a.category, lang);

  if (lang === 'es') {
    const challenge = '🤔 ' + baseTone(tone, `Todo el mundo habla de ${a.title.toLowerCase()}, pero aquí está lo que la mayoría está entendiendo mal.`, lang);
    const reframe = baseTone(tone, `La narrativa se centra en la reacción inmediata, pero la historia real trata sobre ${ctx.topic} — y si lo estamos abordando estratégicamente. ${a.summary}`, lang);
    const dataPoint = tone === 'Thought Leadership'
      ? '📊 La investigación muestra que el 68% de las organizaciones tienen dificultades para convertir prioridades de seguridad en acción operativa.'
      : '📊 La mayoría de organizaciones aún reaccionan a los titulares en lugar de construir proactivamente su hoja de ruta de seguridad.';
    const call = wc === 'short'
      ? `${ctx.question}`
      : `👉 Necesitamos dejar de tratar ${ctx.topic} como una casilla de verificación y empezar a integrar la seguridad en nuestro ADN operativo.\n\n${ctx.question}`;

    if (wc === 'short') {
      return `${challenge}\n\n${reframe}\n\n${call}\n\n${hashtags(a, lang)}`;
    }

    return `${challenge}\n\n${reframe}\n\n${dataPoint}\n\n${call}\n\n${hashtags(a, lang)}`;
  }

  const challenge = '🤔 ' + baseTone(tone, `Everyone is talking about ${a.title.toLowerCase()}, but here's what most are getting wrong.`, lang);
  const reframe = baseTone(tone, `The narrative focuses on the immediate reaction, but the real story is about ${ctx.topic} — and whether we're thinking about it strategically. ${a.summary}`, lang);
  const dataPoint = tone === 'Thought Leadership'
    ? '📊 Research shows 68% of organizations struggle to translate security priorities into operational action.'
    : '📊 Most organizations still react to headlines instead of shaping their security roadmap proactively.';
  const call = wc === 'short'
    ? `${ctx.question}`
    : `👉 We need to stop treating ${ctx.topic} as a checkbox and start building security into our operational DNA.\n\n${ctx.question}`;

  if (wc === 'short') {
    return `${challenge}\n\n${reframe}\n\n${call}\n\n${hashtags(a, lang)}`;
  }

  return `${challenge}\n\n${reframe}\n\n${dataPoint}\n\n${call}\n\n${hashtags(a, lang)}`;
}

function storytellingTemplate(a: NewsArticle, tone: Tone, wc: string, lang: Language): string {
  const ctx = categoryContext(a.category, lang);

  if (lang === 'es') {
    const open = tone === 'Casual'
      ? `📖 Recuerdo la primera vez que tuve que lidiar con ${ctx.incident}...`
      : `📖 Al principio de mi carrera, aprendí una dura lección sobre ${ctx.topic}.`;
    const connect = `Cuando leí sobre ${a.title.toLowerCase()}, me transportó de vuelta.`;
    const lesson = baseTone(tone, a.summary, lang);
    const close = wc === 'short'
      ? `Manténgase atento.`
      : wc === 'medium'
      ? `💡 El panorama ha cambiado, pero los fundamentos no: ${ctx.advice.medium}.`
      : `💡 El panorama ha cambiado drásticamente, pero los fundamentos permanecen: ${ctx.advice.long}. ${baseTone(tone, 'Este último desarrollo es un recordatorio de que la seguridad es un viaje, no un destino.', lang)}`;

    if (wc === 'short') {
      return `${open}\n${connect}\n\n${lesson}\n\n${close}\n\n${hashtags(a, lang)}`;
    }
    return `${open}\n${connect}\n\n${lesson}\n\n${close}\n\n${ctx.question}\n\n${hashtags(a, lang)}`;
  }

  const open = tone === 'Casual'
    ? `📖 I remember the first time I had to deal with ${ctx.incident}...`
    : `📖 Early in my career, I learned a hard lesson about ${ctx.topic}.`;
  const connect = `When I read about ${a.title.toLowerCase()}, it brought me right back.`;
  const lesson = baseTone(tone, a.summary, lang);
  const close = wc === 'short'
    ? `Stay thoughtful.`
    : wc === 'medium'
    ? `💡 The landscape has changed, but the fundamentals haven't: ${ctx.advice.medium}.`
    : `💡 The landscape has changed dramatically, but the fundamentals remain: ${ctx.advice.long}. ${baseTone(tone, 'This latest development is a reminder that security is a journey, not a destination.', lang)}`;

  if (wc === 'short') {
    return `${open}\n${connect}\n\n${lesson}\n\n${close}\n\n${hashtags(a, lang)}`;
  }
  return `${open}\n${connect}\n\n${lesson}\n\n${close}\n\n${ctx.question}\n\n${hashtags(a, lang)}`;
}

/* ------------------------------------------------------------------ */
/*  Daily Digest — Multi-article roundup                               */
/* ------------------------------------------------------------------ */

export function generateDailyDigestPost(articles: NewsArticle[], tone: Tone, length: Length, lang: Language): string {
  const wc = length === 'short' ? 'short' : length === 'medium' ? 'medium' : 'long';
  const maxArticles = wc === 'short' ? 3 : wc === 'medium' ? 5 : 7;
  const selected = articles.slice(0, maxArticles);

  const dateStr = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  if (lang === 'es') {
    const intros: Record<Tone, string> = {
      'Professional': `🔒 Resumen de Ciberseguridad — ${dateStr}\n\nAquí están las historias de seguridad más importantes que necesita conocer hoy:`,
      'Casual': `☕ ${dateStr} — Su resumen diario de ciberseguridad:\n\nEsto es lo que está causando revuelo en infosec hoy:`,
      'Urgent': `🚨 ALERTAS DE SEGURIDAD — ${dateStr.toUpperCase()}\n\nMúltiples incidentes críticos requieren su atención hoy:`,
      'Educational': `📚 Resumen Diario de Ciberseguridad — ${dateStr}\n\nLos desarrollos de hoy en el panorama de seguridad:`,
      'Thought Leadership': `🎯 La Visión Global — ${dateStr}\n\nDesarrollos estratégicos de seguridad que están dando forma a la industria hoy:`,
    };

    const closings: Record<Tone, string> = {
      'Professional': `Manténgase informado. Manténgase seguro.\n\n¿Cuál de estas historias impacta más a su organización? Hágame saber abajo.`,
      'Casual': `¡Ese es el resumen! ¿Alguna de estas le quita el sueño? 😅 Hágame saber en los comentarios.`,
      'Urgent': `Actúe ahora. Revise sus defensas. Comparta esto con su equipo de seguridad.\n\n¿Qué amenaza le preocupa más?`,
      'Educational': `Comprender el panorama de amenazas es el primer paso hacia la resiliencia.\n\n¿Sobre qué tema le gustaría que profundizara?`,
      'Thought Leadership': `El hilo que conecta todas estas: la inversión proactiva en seguridad da dividendos cuando los incidentes ocurren.\n\n¿Cuál es su prioridad estratégica este trimestre?`,
    };

    const severityEmoji: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };

    let body = '';
    selected.forEach((a) => {
      const emoji = severityEmoji[a.severity] || '⚪';
      const title = baseTone(tone, a.title.replace(/\s+/g, ' ').trim(), lang);
      const summary = wc === 'short'
        ? ''
        : wc === 'medium'
        ? `\n${baseTone(tone, a.summary.slice(0, 140), lang)}...`
        : `\n${baseTone(tone, a.summary, lang)}`;
      const link = `\nLeer más: ${a.url}`;

      body += `${emoji} ${title}${summary}${link}\n\n`;
    });

    const hashtagsLine = `#ciberseguridad #infoseguridad #noticiasdiarias #inteligenciadeamenazas`;

    return `${intros[tone]}\n\n${body}${closings[tone]}\n\n${hashtagsLine}`;
  }

  const intros: Record<Tone, string> = {
    'Professional': `🔒 Cybersecurity Roundup — ${dateStr}\n\nHere are the most significant security stories you need to know about today:`,
    'Casual': `☕ ${dateStr} — Your daily cybersecurity catch-up:\n\nHere's what's making waves in infosec today:`,
    'Urgent': `🚨 SECURITY ALERTS — ${dateStr.toUpperCase()}\n\nMultiple critical incidents require your attention today:`,
    'Educational': `📚 Cybersecurity Daily Brief — ${dateStr}\n\nToday's developments across the security landscape:`,
    'Thought Leadership': `🎯 The Big Picture — ${dateStr}\n\nStrategic security developments shaping the industry today:`,
  };

  const closings: Record<Tone, string> = {
    'Professional': `Stay informed. Stay secure.\n\nWhich of these stories impacts your organization the most? Let me know below.`,
    'Casual': `That's the rundown! Any of these keeping you up at night? 😅 Let me know in the comments.`,
    'Urgent': `Act now. Review your defenses. Share this with your security team.\n\nWhich threat concerns you most?`,
    'Educational': `Understanding the threat landscape is the first step toward resilience.\n\nWhat topic would you like me to dive deeper into?`,
    'Thought Leadership': `The thread connecting all of these: proactive investment in security pays dividends when incidents strike.\n\nWhat's your strategic priority this quarter?`,
  };

  const severityEmoji: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };

  let body = '';
  selected.forEach((a) => {
    const emoji = severityEmoji[a.severity] || '⚪';
    const title = baseTone(tone, a.title.replace(/\s+/g, ' ').trim(), lang);
    const summary = wc === 'short'
      ? ''
      : wc === 'medium'
      ? `\n${baseTone(tone, a.summary.slice(0, 140), lang)}...`
      : `\n${baseTone(tone, a.summary, lang)}`;
    const link = `\nRead more: ${a.url}`;

    body += `${emoji} ${title}${summary}${link}\n\n`;
  });

  const hashtagsLine = `#cybersecurity #infosec #dailynews #threatintel`;

  return `${intros[tone]}\n\n${body}${closings[tone]}\n\n${hashtagsLine}`;
}

