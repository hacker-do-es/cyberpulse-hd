PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      category TEXT DEFAULT 'GENERAL',
      published_at TEXT,
      publish_date TEXT,
      read_time TEXT,
      url TEXT NOT NULL UNIQUE,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      rss_url TEXT NOT NULL,
      category TEXT DEFAULT 'GENERAL',
      active INTEGER DEFAULT 1,
      article_count INTEGER DEFAULT 0,
      last_fetch DATETIME,
      custom INTEGER DEFAULT 0
    );
CREATE TABLE fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      articles_found INTEGER DEFAULT 0,
      articles_new INTEGER DEFAULT 0,
      error TEXT,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE schema_metadata (
      key TEXT PRIMARY KEY,
      value INTEGER
    );
CREATE TABLE linkedin_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      redirect_uri TEXT DEFAULT 'http://localhost:3001/api/linkedin/callback',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE linkedin_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT,
      person_urn TEXT,
      access_token TEXT NOT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE linkedin_oauth_states (
      state TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE user_tech_stack (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      technology TEXT NOT NULL,
      version TEXT,
      vendor TEXT,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE);
CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
        language TEXT NOT NULL DEFAULT 'es',
        ai_provider TEXT NOT NULL DEFAULT 'none' CHECK (ai_provider IN ('none', 'anthropic', 'openai')),
        ai_model TEXT,
        ai_key TEXT,
        ai_base_url TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'member')),
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_last_step INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until DATETIME,
        last_login_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CHECK ((role = 'superadmin' AND tenant_id IS NULL) OR (role <> 'superadmin' AND tenant_id IS NOT NULL))
      );
CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('slack', 'rocketchat')),
        webhook_url TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        schedule_type TEXT NOT NULL DEFAULT 'weekly' CHECK (schedule_type IN ('interval', 'weekly')),
        interval_hours INTEGER,
        time_of_day TEXT,
        weekdays TEXT,
        min_severity TEXT NOT NULL DEFAULT 'medium',
        max_items INTEGER NOT NULL DEFAULT 15,
        use_ai INTEGER NOT NULL DEFAULT 1,
        last_run_at DATETIME,
        last_sent_at DATETIME,
        next_run_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      , header_text TEXT, footer_text TEXT);
CREATE TABLE deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL DEFAULT 'schedule',
        status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'error')),
        article_count INTEGER NOT NULL DEFAULT 0,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
CREATE TABLE channel_sent_articles (
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        article_id INTEGER NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, article_id)
      );
INSERT INTO "articles" ("id","title","summary","source","severity","category","published_at","publish_date","read_time","url","fetched_at") VALUES (1,'FortiOS 7.2 flaw 1','Patch now','CERT-EU','critical','VULNERABILITY','2026-11-19T10:00:00.000Z',NULL,NULL,'https://example.com/1','2026-11-19 21:55:42');
INSERT INTO "articles" ("id","title","summary","source","severity","category","published_at","publish_date","read_time","url","fetched_at") VALUES (2,'FortiOS 7.2 flaw 2','Patch now','CERT-EU','critical','VULNERABILITY','2026-11-19T10:00:00.000Z',NULL,NULL,'https://example.com/2','2026-11-19 21:55:42');
INSERT INTO "articles" ("id","title","summary","source","severity","category","published_at","publish_date","read_time","url","fetched_at") VALUES (3,'FortiOS 7.2 flaw 3','Patch now','CERT-EU','critical','VULNERABILITY','2026-11-19T10:00:00.000Z',NULL,NULL,'https://example.com/3','2026-11-19 21:55:42');
INSERT INTO "articles" ("id","title","summary","source","severity","category","published_at","publish_date","read_time","url","fetched_at") VALUES (4,'FortiOS 7.2 flaw 4','Patch now','CERT-EU','critical','VULNERABILITY','2026-11-19T10:00:00.000Z',NULL,NULL,'https://example.com/4','2026-11-19 21:55:42');
INSERT INTO "articles" ("id","title","summary","source","severity","category","published_at","publish_date","read_time","url","fetched_at") VALUES (5,'FortiOS 7.2 flaw 5','Patch now','CERT-EU','critical','VULNERABILITY','2026-11-19T10:00:00.000Z',NULL,NULL,'https://example.com/5','2026-11-19 21:55:42');
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (1,'The Hacker News','https://feeds.feedburner.com/TheHackersNews','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (2,'BleepingComputer','https://www.bleepingcomputer.com/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (3,'SecurityWeek','https://feeds.feedburner.com/securityweek','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (4,'The Record','https://therecord.media/feed/','DATA BREACH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (5,'Krebs on Security','https://krebsonsecurity.com/feed/','PHISHING',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (6,'Ars Technica Security','https://arstechnica.com/security/feed/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (7,'Dark Reading','https://www.darkreading.com/rss.xml','COMPLIANCE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (8,'Threatpost','https://threatpost.com/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (9,'CyberScoop','https://cyberscoop.com/feed','POLICY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (10,'Intelligence Online','https://feeds.feedburner.com/IntelligenceOnline','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (11,'Risky Business','https://risky.biz/rss.xml','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (12,'Schneier on Security','https://www.schneier.com/feed/atom/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (13,'CISA Advisories','https://www.cisa.gov/cybersecurity-advisories/all.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (14,'CISA ICS Advisories','https://www.cisa.gov/cybersecurity-advisories/ics-advisories.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (15,'CISA ICS Medical Advisories','https://www.cisa.gov/cybersecurity-advisories/ics-medical-advisories.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (16,'ASD ACSC Alerts','https://www.cyber.gov.au/rss/alerts','ALERT',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (17,'CERT-FR','https://www.cert.ssi.gouv.fr/feed/','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (18,'JPCERT/CC','https://www.jpcert.or.jp/english/rss/jpcert-en.rdf','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (19,'JPCERT/CC Blog','https://blogs.jpcert.or.jp/en/atom.xml','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (20,'UK NCSC All','https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (21,'UK NCSC News','https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (22,'UK NCSC Reports','https://www.ncsc.gov.uk/api/1/services/v1/report-rss-feed.xml','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (23,'CERT-EU','https://cert.europa.eu/publications/security-advisories-rss','ALERT',1,NULL,NULL,NULL);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (24,'NSA Cybersecurity','https://www.nsa.gov/Press-Room/Press-Releases-Statements/feed/','POLICY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (25,'ENISA','https://www.enisa.europa.eu/rss/publications','POLICY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (26,'FBI Cyber','https://www.fbi.gov/news/feed','THREAT INTEL',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (27,'INCIBE','https://www.incibe.es/incibe-cert/alerta-temprana/avisos/feed','ALERT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (28,'CCN-CERT','https://www.ccn-cert.cni.es/feed/avisos','VULNERABILITY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (29,'OSI','https://www.osi.es/feed/actualidad','AWARENESS',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (30,'Microsoft Security','https://www.microsoft.com/en-us/security/blog/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (31,'Microsoft Security Update Guide','https://api.msrc.microsoft.com/update-guide/rss','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (32,'CrowdStrike Blog','https://www.crowdstrike.com/blog/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (33,'Mandiant','https://www.mandiant.com/resources/blog/rss.xml','THREAT INTEL',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (34,'Sophos News','https://feeds.feedburner.com/sophos/dgdY','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (35,'Tenable Blog','https://www.tenable.com/blog/feed','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (36,'Rapid7 Blog','https://blog.rapid7.com/rss/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (37,'Rapid7 Emergent Threats','https://blog.rapid7.com/tag/emergent-threat-response/rss/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (38,'Qualys Blog','https://blog.qualys.com/feed','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (39,'Fortinet Blog','https://www.fortinet.com/blog/feed','VULNERABILITY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (40,'FortiGuard PSIRT','https://www.fortiguard.com/rss/ir.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (41,'Palo Alto Networks','https://www.paloaltonetworks.com/blog/feed','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (42,'Palo Alto Security Advisories','https://security.paloaltonetworks.com/rss.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (43,'Check Point Blog','https://blog.checkpoint.com/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (44,'Check Point Research','https://research.checkpoint.com/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (45,'Kaspersky Blog','https://www.kaspersky.com/blog/feed/','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (46,'Securelist','https://securelist.com/feed/','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (47,'Bitdefender','https://www.bitdefender.com/blog/api/rss/hotforsecurity/','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (48,'Malwarebytes Labs','https://blog.malwarebytes.com/feed/','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (49,'Cisco Security Blog','https://blogs.cisco.com/security/feed','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (50,'Cisco Talos','https://feeds.feedburner.com/feedburner/Talos','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (51,'Elastic Security Labs','https://www.elastic.co/security-labs/rss/feed.xml','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (52,'Proofpoint Threat Insight','https://www.proofpoint.com/us/threat-insight-blog.xml','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (53,'SentinelOne','https://www.sentinelone.com/blog/feed/','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (54,'Apple Newsroom','https://www.apple.com/newsroom/rss-feed.rss','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (55,'Apple Developer Releases','https://developer.apple.com/news/releases/rss/releases.rss','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (56,'CVEfeed.io','https://cvefeed.io/rssfeed/latest.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (57,'PortSwigger Blog','https://portswigger.net/blog/rss','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (58,'SANS ISC','https://isc.sans.edu/rssfeed.xml','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (59,'SANS ISC Full','https://isc.sans.edu/rssfeed_full.xml','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (60,'Google Project Zero','https://googleprojectzero.blogspot.com/feeds/posts/default?alt=rss','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (61,'Google Online Security','https://feeds.feedburner.com/GoogleOnlineSecurityBlog','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (62,'Google TAG','https://blog.google/threat-analysis-group/rss/','RESEARCH',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (63,'WeLiveSecurity','https://www.welivesecurity.com/en/rss/feed/','MALWARE',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (64,'RedesZone','https://www.redeszone.net/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (65,'Cybersecurity Dive','https://www.cybersecuritydive.com/feeds/news/','INDUSTRY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (66,'Exploit-DB','https://www.exploit-db.com/rss.xml','EXPLOIT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (67,'ZDI Published','https://www.zerodayinitiative.com/rss/published/','EXPLOIT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (68,'ZDI Blog','https://www.zerodayinitiative.com/blog?format=rss','EXPLOIT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (69,'The DFIR Report','https://thedfirreport.com/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (70,'Pen Test Partners','https://www.pentestpartners.com/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (71,'Packet Storm','https://rss.packetstormsecurity.com/files/','EXPLOIT',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (72,'CyberNews','https://cybernews.com/feed/','THREAT INTEL',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (73,'Darknet','http://feeds.feedburner.com/darknethackers','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (74,'Sploitus','https://sploitus.com/rss','EXPLOIT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (75,'Seebug','https://www.seebug.org/rss/new/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (76,'Bugtraq','http://seclists.org/rss/bugtraq.rss','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (77,'CXSecurity','https://cxsecurity.com/wlb/rss/all/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (78,'Security Boulevard','https://securityboulevard.com/feed/','INDUSTRY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (79,'HackerOne Hacktivity','https://rss.ricterz.me/hacktivity','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (80,'InfoSec Write-ups','https://infosecwriteups.com/feed','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (81,'STAR Labs','https://starlabs.sg/publications/index.xml','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (82,'Der Flounder','https://derflounder.wordpress.com/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (83,'Attify Blog','https://blog.attify.com/rss/','IOT',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (84,'Anquanke','https://api.anquanke.com/data/v1/rss','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (85,'4hou','https://www.4hou.com/feed','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (86,'tttang','https://www.tttang.com/rss.xml','RESEARCH',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (87,'paper - Last paper','https://paper.seebug.org/rss/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (88,'NSFocus','http://blog.nsfocus.net/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (89,'Tencent Xuanwu Lab','https://xlab.tencent.com/cn/feed/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (90,'Trickest CVE','https://github.com/trickest/cve/commits/main.atom','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (91,'HackerNews.cc','http://hackernews.cc/feed','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (92,'Cybersecurity News','https://securityonline.info/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (93,'Infosecurity Magazine','http://www.infosecurity-magazine.com/rss/news/','INDUSTRY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (94,'RedPacket Security','https://www.redpacketsecurity.com/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (95,'Cyber Kendra','https://www.cyberkendra.com/feeds/posts/default','THREAT INTEL',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (96,'Vulners','https://vulners.com/rss.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (97,'VulDB','https://vuldb.com/en/?rss.recent','VULNERABILITY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (98,'CERT Vulnerability Notes','http://www.kb.cert.org/vulfeed','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (99,'Trail of Bits','https://blog.trailofbits.com/feed/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (100,'Intigriti','https://blog.intigriti.com/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (101,'Praetorian','https://www.praetorian.com/blog/feed','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (102,'Appsecco','https://blog.appsecco.com/feed','VULNERABILITY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (103,'Troy Hunt','https://www.troyhunt.com/rss/','DATA BREACH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (104,'Hacker News Frontpage','https://hnrss.org/frontpage','TECH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (105,'Kali Linux','https://www.kali.org/rss.xml','TECH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (106,'Google Bug Hunters','https://bughunters.google.com/feed/en','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (107,'NVISO Labs','https://blog.nviso.eu/feed/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (108,'XPN InfoSec Blog','https://blog.xpnsec.com/rss/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (109,'S3cur3Th1sSh1t','https://s3cur3th1ssh1t.github.io/feed.xml','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (110,'MaskRay','https://maskray.me/blog/atom.xml','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (111,'Fuzzing Labs','https://webassembly-security.com/feed/','RESEARCH',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (112,'Wallarm Lab','https://lab.wallarm.com/feed/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (113,'Telekom Security','https://github.security.telekom.com/atom.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (114,'Shubham Shah','https://shubs.io/rss/','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (115,'Joseph Thacker','https://rez0.blog/feed.xml','VULNERABILITY',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (116,'Yassine Aboukir','https://www.yassineaboukir.com/feed.xml','VULNERABILITY',0,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (117,'GuidePoint Security','https://www.guidepointsecurity.com/feed/','THREAT INTEL',1,0,NULL,0);
INSERT INTO "sources" ("id","name","rss_url","category","active","article_count","last_fetch","custom") VALUES (118,'ThreatCluster','https://threatcluster.io/feed.xml','THREAT INTEL',1,0,NULL,0);
INSERT INTO "fetch_log" ("id","source","articles_found","articles_new","error","fetched_at") VALUES (1,'CERT-EU',5,5,NULL,'2026-11-19 21:55:42');
INSERT INTO "schema_metadata" ("key","value") VALUES ('version',10);
INSERT INTO "linkedin_tokens" ("id","person_id","person_urn","access_token","expires_at","created_at","updated_at") VALUES (1,NULL,NULL,'old',NULL,'2026-11-19 21:55:42','2026-11-19 21:55:42');
INSERT INTO "user_tech_stack" ("id","technology","version","vendor","category","created_at","tenant_id") VALUES (1,'WordPress','6.4','Automattic',NULL,'2026-11-19 21:55:42',1);
INSERT INTO "user_tech_stack" ("id","technology","version","vendor","category","created_at","tenant_id") VALUES (2,'FortiOS','7.2','Fortinet',NULL,'2026-11-19 21:55:42',1);
INSERT INTO "user_tech_stack" ("id","technology","version","vendor","category","created_at","tenant_id") VALUES (3,'PHP',NULL,NULL,NULL,'2026-11-19 21:55:42',1);
INSERT INTO "tenants" ("id","name","timezone","language","ai_provider","ai_model","ai_key","ai_base_url","active","created_at") VALUES (1,'Acme','Europe/Madrid','es','anthropic','claude-opus-5-5','enc.v1.7FNvGliw72ywIln9J7JO8YNR0y4nDayWmbfQ90HcxJoxGpxFnTI9KwYHW13I',NULL,1,'2026-11-19 21:55:41');
INSERT INTO "tenants" ("id","name","timezone","language","ai_provider","ai_model","ai_key","ai_base_url","active","created_at") VALUES (2,'Dormant','Europe/Madrid','es','none',NULL,NULL,NULL,0,'2026-11-19 21:55:41');
INSERT INTO "users" ("id","tenant_id","username","display_name","password_hash","role","totp_secret","totp_enabled","totp_last_step","active","failed_logins","locked_until","last_login_at","created_at") VALUES (1,NULL,'root',NULL,'scrypt$32768$8$1$HJ5AWPaE1HjEZbg2psrglg==$Ul5Z+3QMXj6yHwueKkHU5J8EgtH4rLzNoVMS8qMqp2A=','superadmin',NULL,0,NULL,1,0,NULL,NULL,'2026-11-19 21:55:42');
INSERT INTO "users" ("id","tenant_id","username","display_name","password_hash","role","totp_secret","totp_enabled","totp_last_step","active","failed_logins","locked_until","last_login_at","created_at") VALUES (2,1,'Alice','Alice A.','scrypt$32768$8$1$2uCTXfZc/iAPw55fJ098zw==$ylHPOOjoOhwxrEmOOaYAGEFTSTGoxhoUZNoTErT0xBE=','admin','enc.v1.aPqIedGv1tDpRVWXMAITFugjszGPxhZbOCMxyAF2u2dzKIBN+glDWExaIMa6BBfi3bOJuvpm9GkDBsCD',0,NULL,1,0,NULL,NULL,'2026-11-19 21:55:42');
INSERT INTO "users" ("id","tenant_id","username","display_name","password_hash","role","totp_secret","totp_enabled","totp_last_step","active","failed_logins","locked_until","last_login_at","created_at") VALUES (3,1,'bob',NULL,'scrypt$32768$8$1$qe3G6Ewiczf+yX3Tflkwbw==$NCqSmsG4slYOIMFLexnDdYYt7np9DHHXNtP9zidV9Js=','member',NULL,0,NULL,1,2,NULL,NULL,'2026-11-19 21:55:42');
INSERT INTO "sessions" ("id","user_id","active_tenant_id","expires_at","created_at") VALUES ('888d7635ce0e909872b62219e67163072ba519655a4be5bb209d51136eb9f837',2,1,'2026-11-20 09:55:42','2026-11-19 21:55:42');
INSERT INTO "channels" ("id","tenant_id","name","type","webhook_url","active","schedule_type","interval_hours","time_of_day","weekdays","min_severity","max_items","use_ai","last_run_at","last_sent_at","next_run_at","created_at","header_text","footer_text") VALUES (1,1,'#soc','slack','enc.v1.6NG99WFvumlA5BqbrhZVskz39sRiH2peB1CeEi4QNnkRdYFRYoubkB59i3A37yL3gY5HEEwgYlXprB6NgzQctxw6pU2qRQoDXA==',1,'weekly',NULL,'08:30','1,2,3,4,5','medium',15,1,NULL,NULL,'2030-01-01 07:30:00','2026-11-19 21:55:42','Acme · {count}','');
INSERT INTO "deliveries" ("id","channel_id","tenant_id","trigger","status","article_count","detail","created_at") VALUES (1,1,1,'schedule','sent',2,'Delivered 2 articles','2026-11-19 21:55:42');
INSERT INTO "channel_sent_articles" ("channel_id","article_id","sent_at") VALUES (1,1,'2026-11-19 21:55:42');
INSERT INTO "channel_sent_articles" ("channel_id","article_id","sent_at") VALUES (1,2,'2026-11-19 21:55:42');
CREATE INDEX idx_articles_source ON articles(source);
CREATE INDEX idx_articles_fetched ON articles(fetched_at);
CREATE INDEX idx_articles_published ON articles(published_at);
CREATE INDEX idx_articles_severity ON articles(severity);
CREATE INDEX idx_tech_stack ON user_tech_stack(technology, version);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_channels_tenant ON channels(tenant_id);
CREATE INDEX idx_channels_next_run ON channels(next_run_at);
CREATE INDEX idx_deliveries_channel ON deliveries(channel_id, created_at);
CREATE INDEX idx_tech_stack_tenant ON user_tech_stack(tenant_id);
COMMIT;
