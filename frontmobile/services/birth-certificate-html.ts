// Extrait d'acte de naissance (modele du Senegal) rendu en HTML : affiche dans une WebView et converti en PDF
// (expo-print). Les champs sans source dans la demande restent vides (lignes pointillees), rien n'est invente.
import QRCode from 'qrcode';
import type { CertificateRequestView } from '@/services/api';
import { formatDate, verificationLink } from '@/services/certificate-requests';

export const escapeHtml = (value?: string) => {
	if (!value) {
		return '';
	}
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
};

export const splitName = (fullName?: string) => {
	if (!fullName) {
		return { firstNames: '', lastName: '' };
	}
	const parts = fullName.trim().split(/\s+/);
	if (parts.length === 1) {
		return { firstNames: parts[0], lastName: '' };
	}
	return {
		firstNames: parts.slice(0, -1).join(' '),
		lastName: parts[parts.length - 1],
	};
};

export interface BirthCertificateFields {
	region: string;
	departement: string;
	arrondissement: string;
	centre_etat_civil: string;
	annee_registre: string;
	annee_registre_lettres: string;
	an_suffixe: string;
	numero_registre: string;
	numero_registre_lettres: string;
	date_naissance: string;
	annee_naissance: string;
	heure_naissance: string;
	minutes_naissance: string;
	commune_naissance: string;
	sexe_m: string;
	sexe_f: string;
	lieu_naissance: string;
	prenoms: string;
	nom_famille: string;
	prenoms_pere: string;
	nom_pere: string;
	prenoms_mere: string;
	nom_mere: string;
	pays_naissance: string;
	juge_paix_lieu: string;
	date_jugement: string;
	annee_jugement: string;
	an_jugement: string;
	numero_jugement: string;
	numero_jugement_lettres: string;
	page_registre: string;
	annee_inscription: string;
	an_inscription: string;
	centre_delivrance: string;
	agent_nom: string;
	lieu_signature: string;
	date_signature: string;
	officier_nom: string;
	email: string;
	phone: string;
	certificate_id: string;
	payment_status: string;
	payment_reference: string;
	// Bandeau de verification (QR) : lien encode dans le QR et identifiant affiche a cote.
	verify_url: string;
	expires_at: string;
}

export const emptyBirthCertificateFields = (): BirthCertificateFields => ({
	region: '', departement: '', arrondissement: '', centre_etat_civil: '', annee_registre: '',
	annee_registre_lettres: '', an_suffixe: '', numero_registre: '', numero_registre_lettres: '',
	date_naissance: '', annee_naissance: '', heure_naissance: '', minutes_naissance: '',
	commune_naissance: '', sexe_m: '', sexe_f: '', lieu_naissance: '', prenoms: '', nom_famille: '',
	prenoms_pere: '', nom_pere: '', prenoms_mere: '', nom_mere: '', pays_naissance: '',
	juge_paix_lieu: '', date_jugement: '', annee_jugement: '', an_jugement: '', numero_jugement: '',
	numero_jugement_lettres: '', page_registre: '', annee_inscription: '', an_inscription: '',
	centre_delivrance: '', agent_nom: '', lieu_signature: '', date_signature: '', officier_nom: '',
	email: '', phone: '', certificate_id: '', payment_status: '', payment_reference: '',
	verify_url: '', expires_at: '',
});

const UNITS = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
	'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

// Nombre en lettres (0-9999, orthographe francaise : "quatre-vingt-dix", "mil neuf cent ...").
export const numberToFrench = (n: number): string => {
	if (!Number.isInteger(n) || n < 0 || n > 9999) return '';
	if (n < 20) return UNITS[n];
	if (n < 70) {
		const t = Math.floor(n / 10), u = n % 10;
		return TENS[t] + (u === 1 ? ' et un' : u ? `-${UNITS[u]}` : '');
	}
	if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${UNITS[n - 60]}`;
	if (n < 100) return n === 80 ? 'quatre-vingts' : `quatre-vingt-${UNITS[n - 80]}`;
	if (n < 1000) {
		const h = Math.floor(n / 100), r = n % 100;
		const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
		return r ? `${head} ${numberToFrench(r)}` : head;
	}
	const k = Math.floor(n / 1000), r = n % 1000;
	const head = k === 1 ? 'mil' : `${UNITS[k]} mille`;
	return r ? `${head} ${numberToFrench(r)}` : head;
};

// Accepte AAAA-MM-JJ ou JJ/MM/AAAA.
const parseDate = (value: string) => {
	const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
	const fr = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
	const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : fr ? [+fr[3], +fr[2], +fr[1]] : [0, 0, 0];
	return y && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

// Champs de l'extrait a partir de la demande emise (`submittedData` = formulaire de new.tsx).
// Numeros de registre / jugement : absents de la demande, ils restent vides plutot qu'inventes.
export const birthCertificateFieldsFromRequest = (request: CertificateRequestView): BirthCertificateFields => {
	const data = request.submittedData ?? {};
	const name = splitName(text(data.fullName));
	const father = splitName(text(data.fatherName));
	const mother = splitName(text(data.motherName));
	const dateOfBirth = text(data.dateOfBirth);
	const born = parseDate(dateOfBirth);
	const place = text(data.placeOfBirth);
	const gender = text(data.gender).toLowerCase();
	const certificateId = request.certificateId ?? '';
	const yearWords = born ? numberToFrench(born.y) : '';

	return {
		...emptyBirthCertificateFields(),
		// Centre d'etat civil / delivrance / lieu de signature = commune emettrice (a choisir plus tard), pas le lieu de naissance.
		// L'acte est dresse l'annee de la naissance (declaration reguliere) : annee du registre = annee de naissance.
		annee_registre: born ? String(born.y) : '',
		annee_registre_lettres: yearWords,
		date_naissance: born ? `${numberToFrench(born.d)} ${MONTHS[born.m - 1]}` : dateOfBirth,
		annee_naissance: born ? `${yearWords} (${born.y})` : '',
		commune_naissance: place,
		sexe_m: gender.startsWith('m') ? 'X' : '',
		sexe_f: gender.startsWith('f') ? 'X' : '',
		lieu_naissance: place.toUpperCase(),
		prenoms: name.firstNames.toUpperCase(),
		nom_famille: name.lastName.toUpperCase(),
		prenoms_pere: father.firstNames.toUpperCase(),
		nom_pere: father.lastName.toUpperCase(),
		prenoms_mere: mother.firstNames.toUpperCase(),
		nom_mere: mother.lastName.toUpperCase(),
		pays_naissance: (text(data.nationality) || 'SENEGAL').toUpperCase(),
		agent_nom: 'DioteKo',
		date_signature: request.status === 'issued' ? formatDate(request.updatedAt) : '',
		officier_nom: 'Signe electroniquement',
		certificate_id: certificateId,
		payment_reference: request.id,
		verify_url: certificateId ? verificationLink(certificateId) : '',
		expires_at: request.expiresAt ? formatDate(request.expiresAt) : '',
	};
};

// QR en SVG inline : fonctionne hors ligne dans la WebView comme dans le PDF.
export const buildQrSvg = (value: string): Promise<string> =>
	QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

export const buildBirthCertificateHtml = (p: BirthCertificateFields, qrSvg: string) => {
	return `
<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=794" />
	<title>Extrait de naissance - Senegal</title>
	<style>
		:root {
			--border: #222;
			--light: #666;
			--bg: #fff;
			--text: #111;
		}

		* { 
			box-sizing: border-box; 
			overflow-wrap: break-word;
			word-wrap: break-word;
		}

		body {
			margin: 0;
			padding: 16px;
			background: #f2f2f2;
			font-family: "Times New Roman", serif;
			color: var(--text);
		}

		.page {
			width: 100%;
			max-width: 186mm;
			margin: 0 auto;
			background: var(--bg);
			padding: 10mm;
			box-shadow: 0 4px 12px rgba(0,0,0,.1);
			border: 1px solid #ddd;
		}

		.meta {
			border: 1px solid #d5d5d5;
			background: #fafafa;
			padding: 8px 10px;
			margin-bottom: 8px;
			font-size: 11px;
			line-height: 1.4;
			word-break: break-word;
		}

		.certificate { 
			border: 1.2px solid var(--border); 
			padding: 0;
			overflow: hidden;
		}

		.top-grid {
			display: grid;
			grid-template-columns: 1.2fr 1fr;
			border-bottom: 1.2px solid var(--border);
			min-height: 110px;
		}

		.top-left, .top-right { 
			padding: 8px 10px; 
			position: relative;
			overflow: hidden;
		}
		.top-left { border-right: 1.2px solid var(--border); }

		.mini-line {
			border-bottom: 0.8px solid #666;
			padding: 4px 0 6px;
			margin-bottom: 6px;
			font-size: 11px;
			text-transform: uppercase;
			white-space: normal;
			word-break: break-word;
		}

		.mini-line span { display: block; margin-top: 2px; }

		.subnote {
			font-size: 10px;
			color: #333;
			text-align: center;
			margin-top: 10px;
			line-height: 1.2;
			text-transform: none;
		}

		.republic {
			text-align: center;
			font-size: 10px;
			text-transform: uppercase;
			line-height: 1.3;
			margin-top: 2px;
		}

		.country-title {
			text-align: center;
			font-size: 18px;
			letter-spacing: 2px;
			margin: 8px 0 10px;
			text-transform: uppercase;
		}

		.center-box {
			text-align: center;
			font-size: 11px;
			text-transform: uppercase;
			line-height: 1.3;
			margin-top: 4px;
		}

		.center-box strong {
			display: block;
			font-size: 13px;
			margin-top: 3px;
			word-break: break-word;
		}

		.main-title {
			text-align: center;
			font-size: 18px;
			font-weight: 700;
			text-transform: uppercase;
			border-bottom: 1.2px solid var(--border);
			padding: 8px 8px 6px;
			letter-spacing: 0.2px;
		}

		.body { 
			padding: 8px 10px 4px; 
			font-size: 12px; 
			line-height: 1.3;
		}

		.row {
			display: flex;
			gap: 6px;
			align-items: flex-end;
			margin-bottom: 6px;
			flex-wrap: wrap;
		}

		.field {
			display: flex;
			align-items: flex-end;
			gap: 4px;
			flex: 1;
			min-width: 100px;
		}

		.label { 
			white-space: nowrap;
			font-size: 11px;
			flex-shrink: 0;
		}

		.line {
			flex: 1;
			min-height: 16px;
			border-bottom: 0.8px dotted #333;
			padding: 1px 3px 1px;
			font-weight: 500;
			font-size: 12px;
			word-break: break-word;
			overflow-wrap: break-word;
		}

		.line.center { text-align: center; }

		.short { flex: 0 0 90px; }
		.tinyw { flex: 0 0 60px; }
		.mid { flex: 0 0 140px; }
		.wide { flex: 1 1 200px; }

		.sex-boxes {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			margin-left: 2px;
			font-size: 11px;
		}

		.check {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 16px;
			height: 16px;
			border: 0.8px solid var(--border);
			font-size: 10px;
			font-weight: 700;
			line-height: 1;
			flex-shrink: 0;
		}

		.grid-2 {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 6px 10px;
			margin-bottom: 6px;
		}

		.block-field { 
			display: flex; 
			flex-direction: column; 
			gap: 2px;
		}

		.block-field .label {
			font-size: 10px;
			font-weight: 600;
		}

		.block-field .box {
			min-height: 22px;
			border: 0.8px solid #777;
			padding: 2px 4px;
			font-weight: 500;
			font-size: 12px;
			word-break: break-word;
			overflow-wrap: break-word;
		}

		.muted { 
			font-size: 10px; 
			color: #333; 
			line-height: 1.2;
			margin-bottom: 4px;
		}

		.judgment {
			display: grid;
			grid-template-columns: 70px 1fr;
			margin-top: 6px;
			border-top: 1.2px solid var(--border);
			border-bottom: 1.2px solid var(--border);
		}

		.vertical {
			border-right: 1.2px solid var(--border);
			writing-mode: vertical-rl;
			transform: rotate(180deg);
			text-align: center;
			font-size: 9px;
			padding: 6px 2px;
			text-transform: uppercase;
			letter-spacing: 0.3px;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.judgment-content { 
			padding: 6px 8px; 
		}

		/* QR superpose dans l'espace libre a droite de "A / Le" : n'affecte pas la mise en page. */
		.qr-slot {
			position: absolute;
			top: 16px;
			right: 0;
			width: 58px;
			height: 58px;
			background: #fff;
		}

		.qr-slot svg { width: 100%; height: 100%; display: block; }

		.footer-area {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 10px;
			padding: 8px 10px 8px;
			font-size: 12px;
		}

		.footer-box {
			min-height: 100px;
			display: flex;
			flex-direction: column;
			justify-content: space-between;
		}

		.footer-title {
			text-transform: uppercase;
			font-weight: 700;
			text-align: center;
			margin-bottom: 6px;
			font-size: 10px;
		}

		.signature-line {
			border-bottom: 0.8px dotted #333;
			min-height: 14px;
			margin-top: 8px;
			font-size: 11px;
			word-break: break-word;
		}

		.bottom-notes {
			display: flex;
			justify-content: space-between;
			gap: 10px;
			font-size: 9px;
			color: #333;
			padding: 0 10px 6px;
			line-height: 1.2;
		}

		/* Fixed A4 layout (viewport width=794): the WebView scales it to the screen, the PDF prints it as is. */
	</style>
</head>
<body>
	<div class="page">
		<div class="meta">
			<div><strong>ID:</strong> ${escapeHtml(p.certificate_id)} | <strong>Statut:</strong> ${escapeHtml(p.payment_status)}</div>
			<div><strong>Ref:</strong> ${escapeHtml(p.payment_reference)} | <strong>Email:</strong> ${escapeHtml(p.email)}</div>
			<div><strong>Tel:</strong> ${escapeHtml(p.phone)}</div>
		</div>

		<div class="certificate">
			<div class="top-grid">
				<div class="top-left">
					<div class="mini-line">Region<span>${escapeHtml(p.region)}</span></div>
					<div class="mini-line">Departement<span>${escapeHtml(p.departement)}</span></div>
					<div class="mini-line">Arrond.<span>${escapeHtml(p.arrondissement)}</span></div>
					<div class="subnote"><strong>COLLECTIVITE</strong><br/>(Commune/Rurale)</div>
				</div>
				<div class="top-right">
					<div class="republic">REP. DU SENEGAL<br/><span style="font-size:9px;">Un Peuple - Un But - Une Foi</span></div>
					<div class="country-title">ETAT CIVIL</div>
					<div class="center-box">CENTRE DE<strong>${escapeHtml(p.centre_etat_civil)}</strong></div>
				</div>
			</div>

			<div class="main-title">Extrait Acte Naissance</div>

			<div class="body">
				<div class="row">
					<div class="field"><div class="label">Annee</div><div class="line short center">${escapeHtml(p.annee_registre)}</div></div>
					<div class="field"><div class="label">Lettres</div><div class="line">${escapeHtml(p.annee_registre_lettres)}</div></div>
					<div class="field"><div class="label">AN</div><div class="line tinyw center">${escapeHtml(p.an_suffixe)}</div></div>
				</div>

				<div class="row">
					<div class="field"><div class="label">N° Reg.</div><div class="line mid center">${escapeHtml(p.numero_registre)}</div></div>
					<div class="field"><div class="label">Lettres</div><div class="line">${escapeHtml(p.numero_registre_lettres)}</div></div>
				</div>

				<div class="row">
					<div class="field"><div class="label">Date Nais.</div><div class="line">${escapeHtml(p.date_naissance)}</div></div>
					<div class="field"><div class="label">Annee</div><div class="line mid">${escapeHtml(p.annee_naissance)}</div></div>
				</div>

				<div class="row">
					<div class="field"><div class="label">A</div><div class="line tinyw center">${escapeHtml(p.heure_naissance)}</div></div>
					<div class="field"><div class="label">h</div><div class="line tinyw center">${escapeHtml(p.minutes_naissance)}</div></div>
					<div class="field"><div class="label">min</div><div class="line">${escapeHtml(p.commune_naissance)}</div></div>
				</div>

				<div class="row">
					<div class="field">
						<div class="label">Sexe</div>
						<div class="sex-boxes">
							<span class="check">${escapeHtml(p.sexe_m)}</span><span>M</span>
							<span style="margin: 0 2px;">-</span>
							<span class="check">${escapeHtml(p.sexe_f)}</span><span>F</span>
						</div>
					</div>
					<div class="field"><div class="label">Lieu Nais.</div><div class="line">${escapeHtml(p.lieu_naissance)}</div></div>
				</div>

				<div class="grid-2">
					<div class="block-field"><div class="label">PRENOMS</div><div class="box">${escapeHtml(p.prenoms)}</div></div>
					<div class="block-field"><div class="label">NOM FAMILLE</div><div class="box">${escapeHtml(p.nom_famille)}</div></div>
					<div class="block-field"><div class="label">PRENOMS PERE</div><div class="box">${escapeHtml(p.prenoms_pere)}</div></div>
					<div class="block-field"><div class="label">NOM PERE</div><div class="box">${escapeHtml(p.nom_pere)}</div></div>
					<div class="block-field"><div class="label">PRENOMS MERE</div><div class="box">${escapeHtml(p.prenoms_mere)}</div></div>
					<div class="block-field"><div class="label">NOM MERE</div><div class="box">${escapeHtml(p.nom_mere)}</div></div>
				</div>

				<div class="row">
					<div class="field"><div class="label">Pays Nais.</div><div class="line">${escapeHtml(p.pays_naissance)}</div></div>
				</div>
				<div class="muted">Majuscules: lieu naissance, prenoms et nom</div>
			</div>

			<div class="judgment">
				<div class="vertical">JUGEMENT INSCRIPTION</div>
				<div class="judgment-content">
					<div class="row"><div class="field"><div class="label">Juge</div><div class="line">${escapeHtml(p.juge_paix_lieu)}</div></div></div>
					<div class="row">
						<div class="field"><div class="label">Date</div><div class="line mid">${escapeHtml(p.date_jugement)}</div></div>
						<div class="field"><div class="label">Annee</div><div class="line mid">${escapeHtml(p.annee_jugement)}</div></div>
						<div class="field"><div class="label">AN</div><div class="line tinyw center">${escapeHtml(p.an_jugement)}</div></div>
					</div>
					<div class="row">
						<div class="field"><div class="label">N°</div><div class="line mid">${escapeHtml(p.numero_jugement)}</div></div>
						<div class="field"><div class="label">Lettres</div><div class="line">${escapeHtml(p.numero_jugement_lettres)}</div></div>
					</div>
					<div class="row">
						<div class="field"><div class="label">Page</div><div class="line tinyw center">${escapeHtml(p.page_registre)}</div></div>
						<div class="field"><div class="label">Annee Insc.</div><div class="line mid center">${escapeHtml(p.annee_inscription)}</div></div>
						<div class="field"><div class="label">AN</div><div class="line tinyw center">${escapeHtml(p.an_inscription)}</div></div>
					</div>
				</div>
			</div>

			<div class="footer-area">
				<div class="footer-box">
					<div>
						<div class="footer-title">Centre Etat Civil</div>
						<div class="signature-line">${escapeHtml(p.centre_delivrance)}</div>
					</div>
					<div style="margin-top:4px;">
						<div style="font-size:10px;margin-bottom:2px;">Agent</div>
						<div class="signature-line">${escapeHtml(p.agent_nom)}</div>
					</div>
				</div>
				<div class="footer-box" style="position:relative;">
					${p.verify_url ? `<div class="qr-slot">${qrSvg}</div>` : ''}
					<div>
						<div class="footer-title">Extrait Certifie</div>
						<div style="font-size:10px;line-height:1.2;">
							<strong>A</strong> ${escapeHtml(p.lieu_signature)}<br/>
							<strong>Le</strong> ${escapeHtml(p.date_signature)}
						</div>
					</div>
					<div style="text-align:center;">
						<div style="font-size:10px;margin-bottom:4px;">Officier Etat Civil</div>
						<div class="signature-line">${escapeHtml(p.officier_nom)}</div>
					</div>
				</div>
			</div>

			<div class="bottom-notes">
				<div>(1) Notes marginales verso</div>
				<div>(2) Rayer inutile</div>
			</div>
		</div>
	</div>
</body>
</html>
`;
};
