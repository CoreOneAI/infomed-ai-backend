// netlify/functions/hello.mjs
export async function handler(event) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      method: event.httpMethod,
      message: "Functions are working."
    })
  };
}
