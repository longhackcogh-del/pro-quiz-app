const test=require('node:test');
const assert=require('node:assert/strict');
const {parseQuizText}=require('../server/parser');
test('Markdown STEM questions preserve formulas and separate answer markers',()=>{
  const text=String.raw`**Câu 1:** Đạo hàm của \(y=\ln(x^2+1)\) là:
- A. \(\frac{1}{x^2+1}\)
- B. \(\frac{2x}{x^2+1}\)
- C. \(x\)
- D. \(2\)
- **Đáp án đúng: B.**
**Môn Vật lý**
**Câu 2:** Cho \(x=5\cos(10\pi t+\frac{\pi}{3})\), giá trị \(0.2\) là:
A. \(0.2\)
B. \(1\)
C. \(5\)
D. \(10\)
Đáp án: A
Câu 3: Cân bằng \(\ce{Fe + O2 -> Fe3O4}\):
A. \(3:2:1\)
B. \(2:3:1\)
C. \(3:4:1\)
D. \(4:3:2\)
Đáp án đúng: A`;
  const result=parseQuizText(text);assert.equal(result.invalid.length,0);assert.equal(result.questions.length,3);
  assert.deepEqual(result.questions.map(q=>q.answerIndex),[1,0,0]);
  assert.equal(result.questions[0].options[1],String.raw`\(\frac{2x}{x^2+1}\)`);
  assert.ok(result.questions[1].prompt.includes(String.raw`\(0.2\)`));
  assert.ok(result.questions[2].prompt.includes(String.raw`\ce{Fe + O2 -> Fe3O4}`));
  assert.ok(!result.questions[0].options.some(text=>/Đáp án|FORMULATOKEN/.test(text)));
});
test('Double escaped delimiters, Unicode and numbers remain intact',()=>{
  const result=parseQuizText(String.raw`Câu 1: Tính \\(x^2\\) với α ≤ β và H₂SO₄:
A. 123456789
B. ±∞
C. √2
D. ΔE
Đáp án đúng: D`);
  assert.equal(result.questions.length,1);assert.equal(result.questions[0].prompt,String.raw`Tính \(x^2\) với α ≤ β và H₂SO₄:`);
  assert.deepEqual(result.questions[0].options,['123456789','±∞','√2','ΔE']);
});
