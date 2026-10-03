import { afterInquirySaved } from '../../modules/property-records/intake-hook.mjs';

const CONSENT_VERSION = "FLTRACT-CONSENT-2026-09-27-V1";



const FLORIDA_TIME_ZONE = "America/New_York";



const CONSENT_TEXT = `

FLTract Contact Permission and Your Rights



By submitting this form, you are asking FLTract to review your inquiry

and contact you regarding the property or real-estate referral request

you submitted.



FLTract will use the contact information you provide for purposes related

to your inquiry, referral, and appropriate follow-up.



You may withdraw your permission or ask FLTract to stop contacting you

at any time.



Optional future email communications are not required in order to submit

an inquiry or receive referral assistance.



Live telephone-call permission is separate from email permission.



FLTract does not currently use this form to obtain consent for automated

or prerecorded telephone calls or automated marketing text messages.



Submitting this form does not create a brokerage, agency,

attorney-client, or other professional relationship with FLTract or

William E. McMullen II.

`.trim();





/* ============================================================*

*   RESPONSE HELPERS*

*   ============================================================ */



function json(data, status = 200, extraHeaders = {}) {

  return new Response(

    JSON.stringify(data),

    {

      status,

      headers: {

        "content-type": "application/json; charset=utf-8",

        "cache-control": "no-store",

        "x-content-type-options": "nosniff",

        ...extraHeaders

      }

    }

  );

}





function floridaToday() {

  const parts =

    new Intl.DateTimeFormat(

      "en-US",

      {

        timeZone: FLORIDA_TIME_ZONE,

        year: "numeric",

        month: "2-digit",

        day: "2-digit"

      }

    )

    .formatToParts(new Date());



  const values = {};



  for (const part of parts) {

    values[part.type] = part.value;

  }



  return `${values.year}-${values.month}-${values.day}`;

}





function addDays(dateString, days) {

  const [year, month, day] =

    dateString

      .split("-")

      .map(Number);



  const date =

    new Date(

      Date.UTC(

        year,

        month - 1,

        day

      )

    );



  date.setUTCDate(

    date.getUTCDate() + days

  );



  return date

    .toISOString()

    .slice(0, 10);

}





/* ============================================================*

*   STRING / INPUT HELPERS*

*   ============================================================ */



function clean(value, max = 500) {

  return String(value ?? "")

    .trim()

    .slice(0, max);

}





function yes(value) {

  if (value === true) return 1;

  if (value === 1) return 1;



  const v =

    String(value ?? "")

      .trim()

      .toLowerCase();



  return [

    "1",

    "true",

    "yes",

    "on",

    "checked"

  ].includes(v)

    ? 1

    : 0;

}





function validEmail(value) {

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

}





/* ============================================================*

*   REQUEST BODY*

*   Supports JSON or standard HTML form submissions.*

*   Multipart is intentionally rejected because FLTract accepts*

*   NO FILE UPLOADS.*

*   ============================================================ */



async function readInput(request) {

  const contentType =

    request.headers

      .get("content-type") || "";



  if (

    contentType

      .toLowerCase()

      .includes("multipart/form-data")

  ) {

    throw new Error(

      "UPLOADS_NOT_ALLOWED"

    );

  }



  if (

    contentType

      .toLowerCase()

      .includes("application/json")

  ) {

    return await request.json();

  }



  if (

    contentType

      .toLowerCase()

      .includes(

        "application/x-www-form-urlencoded"

      )

  ) {

    const form =

      await request.formData();



    return Object.fromEntries(

      form.entries()

    );

  }



  throw new Error(

    "UNSUPPORTED_CONTENT_TYPE"

  );

}





/* ============================================================*

*   ALLOWED VALUES*

*   ============================================================ */



const INQUIRY_TYPES = [

  "Selling Property I Own",

  "Finding Property to Buy",

  "Both / Exploring Options",

  "General Property Question"

];





const COUNTIES = [

  "Brevard",

  "Indian River",

  "St. Lucie",

  "Martin",

  "Okeechobee",

  "Other Florida County",

  "Not Sure"

];





const PROPERTY_TYPES = [

  "Vacant / Acreage",

  "Agricultural / Farm",

  "Ranch / Cattle",

  "Grove / Citrus",

  "Recreational / Hunting",

  "Timber / Wooded",
  "Commercial Property",
  "Industrial Property",

  "Development / Investment Land",

  "Acreage with Residence",

  "Acreage with Mobile / Manufactured Home",

  "Other / Not Sure"

];





const IMPROVEMENT_OPTIONS = [

  "Yes",

  "No",

  "Not Sure"

];





const CONTACT_METHODS = [

  "Email",

  "Phone",

  "Either Email or Phone"

];





/* ============================================================*

*   WORKER*

*   ============================================================ */



export default {



  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = new Set(["https://fltract.com", "https://www.fltract.com"]);
    if (origin && !allowedOrigins.has(origin)) {
      return json({ok: false, error: "Origin not allowed."}, 403);
    }
    const corsHeaders = origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    } : {};
    const reply = (data, status = 200, headers = {}) => json(data, status, {...corsHeaders, ...headers});
    if (request.method === "OPTIONS") {
      const preflightUrl = new URL(request.url);
      if (preflightUrl.pathname !== "/submit") return reply({ok:false,error:"Not found."},404);
      if (request.headers.get("Access-Control-Request-Method") !== "POST") return reply({ok:false,error:"Method not allowed."},405);
      const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map(h => h.trim()).filter(Boolean);
      if (requestedHeaders.some(h => h !== "content-type")) return reply({ok:false,error:"Header not allowed."},400);
      return new Response(null, {status:204,headers:corsHeaders});
    }



    const url =

      new URL(request.url);





    if (!env.DB) {

      return reply(

        {

          ok: false,

          error: "Database binding DB is missing."

        },

        500

      );

    }





    /* --------------------------------------------------------*

*       HEALTH CHECK*

*       -------------------------------------------------------- */



    if (

      request.method === "GET" &&

      url.pathname === "/"

    ) {



      return reply({

        ok: true,

        service: "FLTract Intake",

        status: "ready",

        public_submissions_enabled: false,

        consent_version: CONSENT_VERSION

      });

    }





    /* --------------------------------------------------------*

*       ONLY /submit ACCEPTS INTAKES*

*       -------------------------------------------------------- */



    if (

      url.pathname !== "/submit"

    ) {



      return reply(

        {

          ok: false,

          error: "Not found."

        },

        404

      );

    }





    if (

      request.method !== "POST"

    ) {



      return reply(

        {

          ok: false,

          error: "Method not allowed."

        },

        405,

        {

          Allow: "POST"

        }

      );

    }





    /* --------------------------------------------------------*

*       PARSE SUBMISSION*

*       -------------------------------------------------------- */



    let input;



    try {



      input =

        await readInput(request);



    }

    catch (error) {



      if (

        error.message ===

        "UPLOADS_NOT_ALLOWED"

      ) {



        return reply(

          {

            ok: false,

            error:

              "FLTract does not accept file uploads through the intake form."

          },

          415

        );



      }





      return reply(

        {

          ok: false,

          error:

            "Unsupported submission format."

        },

        415

      );



    }





    /* --------------------------------------------------------*

*       BOT HONEYPOT*



*       Public form will include a hidden field named:*

*       company_website*



*       Real clients will never fill it out.*

*       -------------------------------------------------------- */



    const honeypot =

      clean(

        input.company_website,

        500

      );





    if (honeypot) {



      /**

*        Do not tell a bot it was detected.*

*      */



      return reply({

        ok: true,

        received: true

      });



    }





    /* --------------------------------------------------------*

*       BASIC CLIENT DATA*

*       -------------------------------------------------------- */



    const inquiryType =

      clean(

        input.inquiry_type,

        100

      );





    const county =

      clean(

        input.county,

        100

      );





    const propertyType =

      clean(

        input.property_type,

        150

      );





    const acreage =

      clean(

        input.acreage,

        100

      );





    const improvements =

      clean(

        input.improvements,

        50

      );





    const propertyLocation =

      clean(

        input.property_location,

        500

      );





    const details =

      clean(

        input.details,

        4000

      );





    const firstName =

      clean(

        input.first_name,

        100

      );





    const lastName =

      clean(

        input.last_name,

        100

      );





    const email =

      clean(

        input.email,

        254

      )

      .toLowerCase();





    const phone =

      clean(

        input.phone,

        100

      );





    const preferredContact =

      clean(

        input.preferred_contact,

        100

      );





    /* --------------------------------------------------------*

*       CONSENT VALUES*

*       -------------------------------------------------------- */



    const rightsAcknowledged =

      yes(

        input.rights_acknowledged

      );





    const relationshipAcknowledged =

      yes(

        input.relationship_acknowledged

      );





    /**

*      Email response to THIS inquiry is required because*

*      FLTract will send the intake receipt to this address.*

*    */



    const inquiryEmailAllowed = 1;




    /**

*      Optional future email marketing / informational outreach.*

*    */



    const marketingEmailOptIn =

      yes(

        input.marketing_email_opt_in

      );





    /**

*      Optional permission for LIVE telephone follow-up.*

*    */



    const liveCallOptIn =

      yes(

        input.live_call_opt_in

      );





    /**

*      Text consent is intentionally NOT enabled yet.*

*      We will build the stronger text-consent process separately.*

*    */



    const textOptIn = 0;





    /* --------------------------------------------------------*

*       VALIDATION*

*       -------------------------------------------------------- */



    const errors = [];





    if (

      !INQUIRY_TYPES.includes(

        inquiryType

      )

    ) {

      errors.push(

        "Please select a valid inquiry type."

      );

    }





    if (

      !COUNTIES.includes(

        county

      )

    ) {

      errors.push(

        "Please select a valid county."

      );

    }





    if (

      !PROPERTY_TYPES.includes(

        propertyType

      )

    ) {

      errors.push(

        "Please select a valid property type."

      );

    }





    if (

      improvements &&

      !IMPROVEMENT_OPTIONS.includes(

        improvements

      )

    ) {

      errors.push(

        "Please select a valid improvements option."

      );

    }





    if (!firstName) {

      errors.push(

        "First name is required."

      );

    }





    if (!lastName) {

      errors.push(

        "Last name is required."

      );

    }





    if (

      !email ||

      !validEmail(email)

    ) {

      errors.push(

        "A valid email address is required."

      );

    }





    if (

      !CONTACT_METHODS.includes(

        preferredContact

      )

    ) {

      errors.push(

        "Please select a preferred contact method."

      );

    }





    if (

      (

        preferredContact === "Phone" ||

        preferredContact ===

          "Either Email or Phone"

      ) &&

      !phone

    ) {

      errors.push(

        "A phone number is required when phone contact is selected."

      );

    }





    if (

      liveCallOptIn === 1 &&

      !phone

    ) {

      errors.push(

        "A phone number is required to authorize telephone contact."

      );

    }





    if (

      rightsAcknowledged !== 1

    ) {

      errors.push(

        "You must acknowledge your contact and withdrawal rights."

      );

    }





    if (

      relationshipAcknowledged !== 1

    ) {

      errors.push(

        "You must acknowledge the FLTract relationship disclosure."

      );

    }





    if (errors.length) {



      return reply(

        {

          ok: false,

          errors

        },

        400

      );



    }





    /* --------------------------------------------------------*

*       LOAD CURRENT COMPLIANCE RULE*

*       -------------------------------------------------------- */



    let liveCallDays = 90;





    try {



      const rule =

        await env.DB.prepare(`

          SELECT rule_value

          FROM compliance_rules

          WHERE rule_key =

            'website_inquiry_live_call_days'

        `)

        .first();





      if (rule) {



        const configured =

          Number(

            rule.rule_value

          );





        if (

          Number.isFinite(

            configured

          ) &&

          configured > 0

        ) {



          liveCallDays =

            configured;



        }



      }



    }

    catch {



      /**

*        Use conservative configured fallback.*

*      */



      liveCallDays = 90;



    }





    /* --------------------------------------------------------*

*       CONTACT AUTHORITY CLOCK*

*       -------------------------------------------------------- */



    const today =

      floridaToday();





    const phoneContactExpires =

      liveCallOptIn === 1

        ?

        addDays(

          today,

          liveCallDays

        )

        :

        null;





    const contactAuthorityBasis =

      liveCallOptIn === 1

        ?

        "Website Inquiry + Client Live Call Permission"

        :

        "Website Inquiry";





    /* --------------------------------------------------------*

*       SAVE INQUIRY FIRST*

*       -------------------------------------------------------- */



    let inquiryId;





    try {



      const insertResult =

        await env.DB.prepare(`

          INSERT INTO inquiries (



            inquiry_type,



            first_name,

            last_name,



            email,

            phone,



            preferred_contact,



            county,



            property_type,



            acreage,



            improvements,



            property_location,



            details,



            status,



            consent_version,



            consent_recorded_at,



            consent_email,



            consent_phone,



            inquiry_email_allowed,



            marketing_email_opt_in,



            live_call_opt_in,



            text_opt_in,



            do_not_email,



            do_not_call,



            do_not_text,



            contact_authority_basis,



            contact_authority_started_at,



            phone_contact_expires_at,



            follow_up_status



          )



          VALUES (



            ?,

            ?,

            ?,

            ?,

            ?,

            ?,

            ?,

            ?,

            ?,

            ?,

            ?,

            ?,



            'New',



            ?,



            CURRENT_TIMESTAMP,



            ?,

            ?,



            ?,

            ?,

            ?,

            ?,



            0,

            0,

            0,



            ?,



            CURRENT_TIMESTAMP,



            ?,



            'None'

          )

        `)

        .bind(



          inquiryType,



          firstName,

          lastName,



          email,

          phone,



          preferredContact,



          county,



          propertyType,



          acreage,



          improvements,



          propertyLocation,



          details,



          CONSENT_VERSION,



          email,

          phone,



          inquiryEmailAllowed,



          marketingEmailOptIn,



          liveCallOptIn,



          textOptIn,



          contactAuthorityBasis,



          phoneContactExpires



        )

        .run();





      inquiryId =

        Number(

          insertResult

            ?.meta

            ?.last_row_id

        );





      if (

        !Number.isInteger(

          inquiryId

        ) ||

        inquiryId < 1

      ) {



        throw new Error(

          "NO_INQUIRY_ID"

        );



      }



    }

    catch (error) {



      console.error(

        "Inquiry insert failed:",

        error

      );





      return reply(

        {

          ok: false,

          error:

            "We were unable to save your inquiry. Please try again later."

        },

        500

      );



    }





    // Optional industry module: the core inquiry has already been durably saved.
    const propertyResearch = await afterInquirySaved({ inquiryId, input, env, ctx });

    /* --------------------------------------------------------*

*       CONSENT SNAPSHOT*



*       One general record preserves the exact consent text/version*

*       plus the client's selected permissions.*

*       -------------------------------------------------------- */



    try {



      await env.DB.prepare(`

        INSERT INTO consent_history (



          inquiry_id,



          event_type,



          channel,



          purpose,



          permission_granted,



          consent_version,



          contact_value,



          source,



          event_note



        )



        VALUES (

          ?,

          'Consent Submitted',

          'General',

          'Client Intake',

          1,

          ?,

          ?,

          'Client Intake Form',

          ?

        )

      `)

      .bind(



        inquiryId,



        CONSENT_VERSION,



        email,


        [

          CONSENT_TEXT,

          "",

          `Selections:`,

          `Inquiry email contact: YES`,

          `Optional future email: ${

            marketingEmailOptIn

              ? "YES"

              : "NO"

          }`,

          `Live telephone contact: ${

            liveCallOptIn

              ? "YES"

              : "NO"

          }`,

          `Text consent: NO / NOT OFFERED`,

          `Rights acknowledged: YES`,

          `Relationship disclosure acknowledged: YES`

        ].join("\n")



      )

      .run();





      /* ---------- INQUIRY EMAIL PERMISSION ---------- */



      await env.DB.prepare(`

        INSERT INTO consent_history (



          inquiry_id,



          event_type,



          channel,



          purpose,



          permission_granted,



          consent_version,



          contact_value,



          source,



          event_note



        )



        VALUES (

          ?,

          'Permission Granted',

          'Email',

          'Current Inquiry and Referral Follow-Up',

          1,

          ?,

          ?,

          'Client Intake Form',

          ?

        )

      `)

      .bind(



        inquiryId,



        CONSENT_VERSION,



        email,



        "Client authorized email communication concerning the submitted inquiry and appropriate referral follow-up."



      )

      .run();





      /* ---------- OPTIONAL MARKETING EMAIL ---------- */



      await env.DB.prepare(`

        INSERT INTO consent_history (



          inquiry_id,



          event_type,



          channel,



          purpose,



          permission_granted,



          consent_version,



          contact_value,



          source,



          event_note



        )



        VALUES (

          ?,

          ?,

          'Email',

          'Optional Future Email Communications',

          ?,

          ?,

          ?,

          'Client Intake Form',

          ?

        )

      `)

      .bind(



        inquiryId,



        marketingEmailOptIn

          ?

          "Permission Granted"

          :

          "Permission Not Granted",



        marketingEmailOptIn,



        CONSENT_VERSION,



        email,



        marketingEmailOptIn

          ?

          "Client affirmatively selected optional future email communications."

          :

          "Client did not select optional future email communications."



      )

      .run();





      /* ---------- LIVE CALL PERMISSION ---------- */



      await env.DB.prepare(`

        INSERT INTO consent_history (



          inquiry_id,



          event_type,



          channel,



          purpose,



          permission_granted,



          consent_version,



          contact_value,



          source,



          event_note



        )



        VALUES (

          ?,

          ?,

          'Phone',

          'Live Telephone Follow-Up',

          ?,

          ?,

          ?,

          'Client Intake Form',

          ?

        )

      `)

      .bind(



        inquiryId,



        liveCallOptIn

          ?

          "Permission Granted"

          :

          "Permission Not Granted",



        liveCallOptIn,



        CONSENT_VERSION,



        phone,



        liveCallOptIn

          ?

          `Client affirmatively authorized live telephone follow-up. Current configured contact-through date: ${phoneContactExpires}.`

          :

          "Client did not affirmatively authorize live telephone follow-up through this consent option."



      )

      .run();



    }

    catch (error) {



      console.error(

        "Consent history logging failed:",

        error

      );



      /**

*        The inquiry has already been safely stored.*

*        Do NOT delete it because a secondary audit write failed.*

*      */



    }





    /* --------------------------------------------------------*

*       INITIAL ACTIVITY HISTORY*

*       -------------------------------------------------------- */



    try {



      await env.DB.prepare(`

        INSERT INTO activity_log (



          inquiry_id,



          activity_type,



          activity_note



        )



        VALUES (

          ?,

          'Client Intake',

          ?

        )

      `)

      .bind(



        inquiryId,



        `Client intake received through FLTract public intake system. Consent version: ${CONSENT_VERSION}.`



      )

      .run();



    }

    catch (error) {



      console.error(

        "Activity log insert failed:",

        error

      );



    }





    /* --------------------------------------------------------
*       SEND ACKNOWLEDGMENT EMAIL + LOG RESULT
*
*       IMPORTANT:
*       The inquiry has already been stored before this step.
*       Email failure must never cause the intake itself to fail.
*       -------------------------------------------------------- */

    let acknowledgmentEmailStatus = "not_attempted";
    let emailLogId = null;

    try {

      const emailLogResult = await env.DB.prepare(`
        INSERT INTO email_log (
          inquiry_id,
          email_type,
          recipient,
          subject,
          status
        )
        VALUES (
          ?,
          'Intake Acknowledgment',
          ?,
          'FLTract Inquiry Receipt',
          'Prepared'
        )
      `)
      .bind(
        inquiryId,
        email
      )
      .run();

      emailLogId =
        Number(
          emailLogResult
            ?.meta
            ?.last_row_id
        ) || null;

      const emailText =
`Thank you for contacting FLTract. We have received your property inquiry and will begin the review process using the information you provided.

FLTract is an information and referral resource. When appropriate, your inquiry will be referred to a licensed real estate professional best suited to the property and circumstances described.

Please do not send sensitive financial information, passwords, Social Security numbers, or transaction documents through the FLTract contact form.

We appreciate your contacting FLTract and look forward to serving you.`;

      const emailHtml = `
        <p>Thank you for contacting FLTract. We have received your property inquiry and will begin the review process using the information you provided.</p>
        <p>FLTract is an information and referral resource. When appropriate, your inquiry will be referred to a licensed real estate professional best suited to the property and circumstances described.</p>
        <p><strong>Please do not send sensitive financial information, passwords, Social Security numbers, or transaction documents through the FLTract contact form.</strong></p>
        <p>We appreciate your contacting FLTract and look forward to serving you.</p>
      `;

      const sendResult = await env.SEND_EMAIL.send({
        to: email,
        from: "noreply@fltract.com",
        subject: "FLTract Inquiry Receipt",
        text: emailText,
        html: emailHtml
      });

      acknowledgmentEmailStatus = "sent";

      if (emailLogId) {

        await env.DB.prepare(`
          UPDATE email_log
          SET
            status = 'Sent',
            provider_message_id = ?,
            sent_at = CURRENT_TIMESTAMP,
            failure_reason = NULL
          WHERE id = ?
        `)
        .bind(
          sendResult?.messageId ?? null,
          emailLogId
        )
        .run();

      }

    }
    catch (error) {

      acknowledgmentEmailStatus = "failed";

      console.error(
        "Intake acknowledgment email failed:",
        error
      );

      try {

        if (emailLogId) {

          await env.DB.prepare(`
            UPDATE email_log
            SET
              status = 'Failed',
              failure_reason = ?
            WHERE id = ?
          `)
          .bind(
            String(
              error?.message ||
              error ||
              "Unknown email sending error"
            ),
            emailLogId
          )
          .run();

        }

      }
      catch (logError) {

        console.error(
          "Email failure logging also failed:",
          logError
        );

      }

    }



    /* --------------------------------------------------------*

*       SUCCESS*

*       -------------------------------------------------------- */



    return reply(

      {

        ok: true,



        inquiry_id:

          inquiryId,



        message:

          "Your FLTract property inquiry has been received.",



        acknowledgment_email:

          acknowledgmentEmailStatus,

        property_research: propertyResearch,



        consent_version:

          CONSENT_VERSION

      },

      201

    );



  }



};