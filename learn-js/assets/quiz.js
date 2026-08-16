/* learn-js 可复用测验组件。
 * 用法：在 HTML 中写：
 *   <div class="quiz" data-q="问题文本">
 *     <button data-answer data-correct>选项A</button>
 *     <button data-answer>选项B</button>
 *     <button data-answer>选项C</button>
 *   </div>
 * 点选后立即反馈，答错提示正确答案。
 */
(function () {
	function decorate(quiz) {
		const q = quiz.getAttribute("data-q") || "问题";
		const label = document.createElement("p");
		label.className = "quiz-q";
		label.textContent = "Q: " + q;
		quiz.prepend(label);

		const feedback = document.createElement("p");
		feedback.className = "quiz-fb";
		quiz.appendChild(feedback);

		const buttons = quiz.querySelectorAll("[data-answer]");
		buttons.forEach((btn) => {
			btn.setAttribute("type", "button");
			btn.addEventListener("click", () => {
				const isCorrect = btn.hasAttribute("data-correct");
				feedback.textContent = isCorrect
					? "✓ 正确！"
					: "✗ 不对。再想想，看上面讲解。";
				feedback.className = "quiz-fb " + (isCorrect ? "good" : "bad");
				buttons.forEach((b) => b.disabled = true);
			});
		});
	}

	document.addEventListener("DOMContentLoaded", () => {
		document.querySelectorAll(".quiz").forEach(decorate);
	});
})();
