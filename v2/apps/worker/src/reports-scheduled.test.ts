import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { smtpSender } from "./reports-scheduled";
import { monthlyReportPdf } from "./monthly-report-pdf";

describe("reports.scheduled SMTP", () => {
  it("bez providera ne izmišlja uspjeh", () => { expect(smtpSender({})).toBeNull(); });
  it("ne pokušava anonimno slanje s nepotpunim SMTP kredencijalima", () => {
    expect(() => smtpSender({SMTP_HOST:"mail.example.test", SMTP_FROM:"a@example.test", SMTP_USER:"user"})).toThrow("SMTP_AUTH_INCOMPLETE");
  });
  it("šalje stvarni PDF preko SMTP-a i ne otkriva BCC u zaglavljima", async () => {
    let received="";
    const server=createServer(socket=>{
      socket.write("220 test ESMTP\r\n");let input="",data=false;
      socket.on("data",chunk=>{input+=chunk.toString();
        while(true) {
          if(data) { const end=input.indexOf("\r\n.\r\n");if(end<0)return;received+=input.slice(0,end);input=input.slice(end+5);data=false;socket.write("250 accepted\r\n");continue; }
          const end=input.indexOf("\r\n");if(end<0)return;const line=input.slice(0,end);input=input.slice(end+2);
          if(/^EHLO|^HELO/i.test(line))socket.write("250-test\r\n250 SIZE 10485760\r\n");
          else if(/^DATA/i.test(line)){data=true;socket.write("354 go ahead\r\n");}
          else if(/^QUIT/i.test(line)){socket.write("221 bye\r\n");socket.end();}
          else socket.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    try {
      const address=server.address();if(!address || typeof address === "string")throw new Error("NO_PORT");
      const send=smtpSender({SMTP_HOST:"127.0.0.1",SMTP_PORT:String(address.port),SMTP_FROM:"sender@example.test"});
      expect(send).not.toBeNull();await send!({recipients:["recipient@example.test"],subject:"Test",pdf:monthlyReportPdf(["Test"]),messageId:"<test@example.test>"});
      expect(received).toContain("Content-Type: application/pdf");expect(received).toContain("JVBERi0xLjQ");expect(received).not.toMatch(/^Bcc:/im);
    } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
