// pdftext.swift — zero-dependency PDF text extraction via PDFKit (macOS).
// Usage: swift pdftext.swift <file.pdf>   (prints the document text)
import Foundation
import PDFKit
let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("pdftext: cannot open \(args.count > 1 ? args[1] : "<missing path>")\n".data(using: .utf8)!)
  exit(1)
}
print(doc.string ?? "")
