import { refs } from './api.js';
import { MEMBER_COLORS, CATEGORY_COLORS, DAY_ORDER } from './main.js';

let sortState = {};

const $ = (selector) => document.querySelector(selector);

function openModal(modalId) {
    const modal = $(`#${modalId}`);
    if (modal) modal.style.display = 'flex';
}

function closeModal(modalId) {
    const modal = $(`#${modalId}`);
    if (modal) modal.style.display = 'none';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

function setupCloseButtons() {
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            btn.closest('.modal').style.display = 'none';
        };
    });
}

function renderMainContent(activeView, currentDate, allRecipes, onNavigate) {
    const mainContent = $('.main-content');
    if (activeView === 'dashboard') {
        mainContent.innerHTML = `<div class="view-container">
            <h2>Tableau de bord - Aujourd'hui</h2>
            <div class="dashboard-grid">
                <div class="dashboard-card" id="dashboard-meals"><h3>Repas</h3></div>
                <div class="dashboard-card" id="dashboard-tasks"><h3>Tâches</h3></div>
                <div class="dashboard-card" id="dashboard-events"><h3>Événements</h3></div>
                <div class="dashboard-card" id="dashboard-groceries"></div>
            </div>
        </div>`;
        setTimeout(renderDashboard, 0);
    } else if (activeView === 'calendar') {
        mainContent.innerHTML = `
            <div class="calendar-container">
                <div class="calendar-header">
                    <button id="prev-month-btn">&lt; Précédent</button>
                    <h2 id="month-year-header"></h2>
                    <button id="next-month-btn">Suivant &gt;</button>
                </div>
                <div class="calendar-grid" id="day-headers"></div>
                <div class="calendar-grid" id="calendar-body"></div>
            </div>`;
        renderCalendar(currentDate);
    } else if (activeView === 'tasks') {
        mainContent.innerHTML = `<div class="view-container">
            <h2>Tâches</h2>
            <form id="add-task-form" class="form-group">
                <input type="text" id="task-title" placeholder="Nouvelle tâche..." required>
                <textarea id="task-description" placeholder="Description..."></textarea>
                <input type="date" id="task-due-date">
                <select id="task-assignee"></select>
                <button type="submit">Ajouter Tâche</button>
            </form>
            <div id="task-list"></div>
        </div>`;
        renderTasks();
    } else if (activeView === 'groceries') {
        mainContent.innerHTML = `<div class="view-container">
            <h2>Épicerie</h2>
            <div class="grocery-actions">
                <button id="generate-grocery-list-btn">Générer la liste pour la semaine</button>
            </div>
            <form id="add-grocery-form" class="form-group">
                <input type="text" id="grocery-item-name" placeholder="Ajouter un article..." required>
                <button type="submit">Ajouter</button>
            </form>
            <div id="grocery-list"></div>
        </div>`;
        renderGroceries();
    } else if (activeView === 'recipes') {
         mainContent.innerHTML = `<div class="view-container"><h2>Livre de recettes</h2><input type="text" id="recipe-search" placeholder="Rechercher une recette..."><div id="recipe-book-table-container"><table id="recipe-book-table"></table></div></div>`;
         renderRecipeBook(allRecipes);
    }
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === activeView) {
            item.classList.add('active');
        }
    });
}

function renderDashboard(getMeal, getTasksForDate) {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    getMeal(dateStr).then(mealData => {
        const dashboardMeals = $('#dashboard-meals');
        dashboardMeals.innerHTML = '<h3>Repas</h3>';
        ['Déjeuner', 'Souper'].forEach(repas => {
            const meal = mealData[repas.toLowerCase()];
            dashboardMeals.innerHTML += `<p><strong>${repas}:</strong> ${meal && meal.plat ? meal.plat : 'Non planifié'}</p>`;
        });
    });

    getTasksForDate(dateStr).then(tasksSnap => {
        const dashboardTasks = $('#dashboard-tasks');
        dashboardTasks.innerHTML = '<h3>Tâches du jour</h3>';
        if (tasksSnap.empty) {
            dashboardTasks.innerHTML += '<p>Aucune tâche pour aujourd\'hui.</p>';
        } else {
            tasksSnap.forEach(doc => dashboardTasks.innerHTML += `<p>${doc.data().title}</p>`);
        }
    });

    const dashboardGroceries = $('#dashboard-groceries');
    if (dashboardGroceries) {
        dashboardGroceries.innerHTML = `
            <h3>Épicerie - Ajout rapide</h3>
            <form id="dashboard-add-grocery-form" class="form-group">
                <input type="text" id="dashboard-grocery-item-name" placeholder="Ajouter un article..." required>
                <button type="submit">Ajouter</button>
            </form>
            <div id="dashboard-grocery-feedback" class="feedback-message"></div>
        `;
    }
}

function renderCalendar(date) {
    const year = date.getFullYear(), month = date.getMonth();
    $("#month-year-header").textContent = date.toLocaleString('fr-CA', { month: 'long', year: 'numeric' });

    const calendarBody = $("#calendar-body");
    const dayHeaders = $("#day-headers");
    dayHeaders.innerHTML = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map(d => `<div class="calendar-day-header">${d}</div>`).join('');

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    calendarBody.innerHTML = Array(firstDayOfMonth).fill(`<div class="calendar-day other-month"></div>`).join('');

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        calendarBody.innerHTML += `
            <div class="calendar-day" data-date="${dateStr}">
                <div class="day-number">${day}</div>
                <div class="day-content">
                    <div class="day-meals">
                        <div class="meal-slot" data-meal-type="Déjeuner" id="dejeuner-${dateStr}"></div>
                        <div class="meal-slot" data-meal-type="Souper" id="souper-${dateStr}"></div>
                    </div>
                    <div class="day-events"></div>
                </div>
            </div>`;
    }

    listenForCalendarData(year, month);
}

function listenForCalendarData(year, month, allRecipes, cycleStartDate) {
    refs.meals.onSnapshot(snap => {
        const manualMeals = {};
        snap.forEach(doc => manualMeals[doc.id] = doc.data());

        document.querySelectorAll(".calendar-day[data-date]").forEach(dayCell => {
            const dateStr = dayCell.dataset.date;
            const current = new Date(dateStr + 'T12:00:00');
            const manual = manualMeals[dateStr];

            const diffDays = Math.floor((current - cycleStartDate) / (1000 * 3600 * 24));
            const week = (Math.floor(diffDays / 7) % 3) + 1;
            const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][current.getDay()];

            ['Déjeuner', 'Souper'].forEach(repas => {
                const mealTypeLower = repas.toLowerCase();
                const manualMeal = manual ? manual[repas.toLowerCase()] : undefined;
                const autoMeal = allRecipes.find(r => r.Semaine == week && r.Jour === dayName && r.Repas === repas);

                const mealToDisplay = manualMeal !== undefined ? manualMeal : (autoMeal ? { recipeId: autoMeal.id, plat: autoMeal.Plat } : null);
                updateMealSlot(`${mealTypeLower}-${dateStr}`, mealToDisplay);
            });
        });
    });

    refs.events.onSnapshot(snap => {
        document.querySelectorAll('.event-item').forEach(el => el.remove());
        snap.forEach(doc => {
            const event = { id: doc.id, ...doc.data() };
            const dayCell = document.querySelector(`.calendar-day[data-date="${event.date}"]`);
            if (dayCell) {
                const eventsContainer = dayCell.querySelector('.day-events');
                const eventEl = document.createElement('div');
                eventEl.className = 'event-item';
                eventEl.textContent = event.title;
                eventEl.dataset.eventId = event.id;
                eventEl.style.backgroundColor = CATEGORY_COLORS[event.category] || '#e2e3e5';
                eventEl.style.color = '#333';
                eventsContainer.appendChild(eventEl);
            }
        });
    });
}

function showRecipeDetails(recipeId, allRecipes, activeDate, activeMealType) {
    const recipe = allRecipes.find(r => r.id === recipeId);
    if (!recipe) return;

    let ingredientsHTML = '<ul><li>Aucun ingrédient listé.</li></ul>';
    if (recipe.Ingrédients) {
        try {
            let ingredients = JSON.parse(recipe.Ingrédients);
            if (Array.isArray(ingredients)) {
                ingredientsHTML = '<ul>' + ingredients.map(ing => `<li>${[ing.qte, ing.unite, ing.nom].filter(Boolean).join(' ')}</li>`).join('') + '</ul>';
            }
        } catch (e) {
            ingredientsHTML = `<ul>${recipe.Ingrédients.split('\n').map(i => `<li>${i}</li>`).join('')}</ul>`;
        }
    }

    $("#recipe-details-content").innerHTML = `
        <h3>${recipe.Plat}</h3>
        <h4>Ingrédients :</h4>
        ${ingredientsHTML}
        <h4>Recette :</h4>
        <pre>${recipe.Recette || ''}</pre>
    `;

    const chefContainer = $("#chef-assignment-container");
    const chefOptions = Object.keys(MEMBER_COLORS).map(chef => `<option value="${chef}">${chef}</option>`).join('');
    chefContainer.innerHTML = `<label for="chef-select">Chef assigné :</label>
                             <select id="chef-select"><option value="">-- Choisir --</option>${chefOptions}</select>`;

    refs.meals.doc(activeDate).get().then(doc => {
        if (doc.exists && doc.data()[activeMealType.toLowerCase()]) {
            $("#chef-select").value = doc.data()[activeMealType.toLowerCase()].chef || "";
        }
    });

    openModal('recipe-details-modal');
}

function showRecipeSelection(allRecipes, activeMealType) {
    const filteredRecipes = allRecipes
        .filter(r => r.Repas === activeMealType)
        .sort((a,b) => a.Plat.localeCompare(b.Plat));

    const listElement = $("#recipe-select-list");
    if (listElement) {
        listElement.innerHTML = filteredRecipes.map(r =>
            `<div class="recipe-select-item" data-id="${r.id}" data-plat="${r.Plat}">${r.Plat}</div>`
        ).join('');
    }

    const searchInput = $("#recipe-select-search");
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.recipe-select-item').forEach(item => {
                item.style.display = item.textContent.toLowerCase().includes(query) ? 'block' : 'none';
            });
        };
    }

    openModal('recipe-select-modal');
}

function showEventModal(date, eventId = null, getEvent) {
    const form = $('#event-form');
    form.reset();
    $('#event-id').value = eventId || '';
    $('#event-date').value = date || '';
    $('#delete-event-btn').style.display = eventId ? 'inline-block' : 'none';
    $('#event-modal-title').textContent = eventId ? 'Modifier l\'événement' : 'Ajouter un événement';

    $('#event-category').innerHTML = Object.keys(CATEGORY_COLORS).map(cat => `<option>${cat}</option>`).join('');
    $('#event-assignees').innerHTML = Object.keys(MEMBER_COLORS).map(member =>
        `<div><input type="checkbox" id="assignee-${member}" value="${member}"><label for="assignee-${member}">${member}</label></div>`
    ).join('');

    if (eventId) {
        getEvent(eventId).then(doc => {
            if (doc.exists) {
                const event = doc.data();
                $('#event-title').value = event.title;
                $('#event-category').value = event.category;
                $('#event-date').value = event.date;
                if (event.assignees) {
                    event.assignees.forEach(assignee => {
                        const checkbox = $(`#assignee-${assignee}`);
                        if (checkbox) checkbox.checked = true;
                    });
                }
            }
        });
    }

    openModal('event-modal');
}

function updateMealSlot(elementId, mealData) {
    const slot = $(`#${elementId}`);
    if (!slot) return;

    slot.dataset.mealData = JSON.stringify(mealData || {});
    slot.style.backgroundColor = 'transparent';

    if (mealData && mealData.plat) {
        if (mealData.chef && MEMBER_COLORS[mealData.chef]) {
            slot.style.backgroundColor = MEMBER_COLORS[mealData.chef];
        }
        slot.innerHTML = `<span class="meal-name" data-recipe-id="${mealData.recipeId}">${mealData.plat}</span>`;
    } else if (mealData === null) {
        slot.innerHTML = '<i>(Retiré)</i>';
    } else {
        slot.innerHTML = '<i>(Non planifié)</i>';
    }
}

function renderTasks() {
    const assigneeSelect = $('#task-assignee');
    if (assigneeSelect) {
        assigneeSelect.innerHTML = Object.keys(MEMBER_COLORS).map(m => `<option>${m}</option>`).join('');
    }

    refs.tasks.orderBy('createdAt', 'asc').onSnapshot(snap => {
        const taskList = $('#task-list');
        if (!taskList) return;
        taskList.innerHTML = '';
        snap.forEach(doc => {
            const task = {id: doc.id, ...doc.data()};
            const item = document.createElement('div');
            item.className = `task-item ${task.completed ? 'completed' : ''}`;
            item.innerHTML = `
                <input type="checkbox" ${task.completed ? 'checked' : ''}>
                <div class="task-item-details">
                    <span>${task.title}</span>
                    ${task.dueDate ? `<div class="due-date">Échéance: ${task.dueDate}</div>` : ''}
                    ${task.assignee ? `<div class="assignee" style="color:${MEMBER_COLORS[task.assignee] || '#333'}">Assigné à: ${task.assignee}</div>` : ''}
                </div>
            `;
            item.querySelector('input').addEventListener('change', (e) => refs.tasks.doc(task.id).update({ completed: e.target.checked }));
            taskList.appendChild(item);
        });
    });
}

function renderGroceries() {
    refs.groceries.orderBy('completed').orderBy('createdAt', 'asc').onSnapshot(snap => {
        const groceryList = $('#grocery-list');
        if (!groceryList) return;
        groceryList.innerHTML = '';
        snap.forEach(doc => {
            const itemData = {id: doc.id, ...doc.data()};
            const item = document.createElement('div');
            item.className = `grocery-item ${itemData.completed ? 'completed' : ''}`;
            item.innerHTML = `<input type="checkbox" ${itemData.completed ? 'checked' : ''}><span>${itemData.name}</span>`;
            item.querySelector('input').addEventListener('change', (e) => refs.groceries.doc(itemData.id).update({ completed: e.target.checked }));
            groceryList.appendChild(item);
        });
    });
}

function renderRecipeBook(allRecipes) {
    const sortedRecipes = [...allRecipes].sort((a, b) => (a.Semaine - b.Semaine) || ((DAY_ORDER[a.Jour] || 99) - (DAY_ORDER[b.Jour] || 99)));
    renderRecipeTable(sortedRecipes, allRecipes);

    const searchInput = $('#recipe-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filteredRecipes = allRecipes.filter(r =>
                Object.values(r).some(val => String(val).toLowerCase().includes(query))
            );
            renderRecipeTable(filteredRecipes, allRecipes);
        });
    }
}

function renderRecipeTable(recipes, allRecipes) {
    const table = $("#recipe-book-table");
    if (!table) return;

    if (recipes.length === 0) {
        table.innerHTML = '<thead><tr><th>Aucune recette trouvée.</th></tr></thead>';
        return;
    }

    const headers = ["Plat", "Repas", "Jour", "Semaine"];
    table.innerHTML = `
        <thead><tr>${headers.map(h => `<th data-sort="${h}">${h} ▾</th>`).join('')}</tr></thead>
        <tbody>${recipes.map(r => `<tr data-id="${r.id}">${headers.map(h => `<td>${r[h] || ''}</td>`).join('')}</tr>`).join('')}</tbody>
    `;

    table.querySelector('thead').addEventListener('click', e => {
        const header = e.target.closest('th');
        if (!header || !header.dataset.sort) return;

        const sortKey = header.dataset.sort;
        const currentDirection = sortState[sortKey] || 'asc';
        const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
        sortState = { [sortKey]: newDirection };

        const sorted = [...recipes].sort((a, b) => {
            const valA = a[sortKey], valB = b[sortKey];
            const modifier = newDirection === 'asc' ? 1 : -1;
            if (sortKey === 'Semaine') return (parseInt(valA) - parseInt(valB)) * modifier;
            if (sortKey === 'Jour') return ((DAY_ORDER[valA] || 99) - (DAY_ORDER[valB] || 99)) * modifier;
            return String(valA).localeCompare(String(valB)) * modifier;
        });
        renderRecipeTable(sorted, allRecipes);
    });
}

function showEditRecipeModal(recipeId = null, allRecipes) {
    const modal = $('#edit-recipe-modal');
    const form = $('#edit-recipe-form');
    const title = $('#edit-recipe-title');
    form.innerHTML = '';

    const recipe = recipeId ? allRecipes.find(r => r.id === recipeId) : {};
    title.textContent = recipeId ? 'Modifier la recette' : 'Ajouter une nouvelle recette';

    const fields = ['Plat', 'Repas', 'Jour', 'Semaine', 'Ingrédients', 'Recette'];
    fields.forEach(field => {
        const value = recipe[field] || '';
        const isTextarea = ['Ingrédients', 'Recette'].includes(field);
        const inputType = isTextarea ?
            `<textarea name="${field}" rows="5">${value}</textarea>` :
            `<input type="text" name="${field}" value="${value}">`;

        form.innerHTML += `<div class="form-group"><label>${field}</label>${inputType}</div>`;
    });

    let formActionsHTML = `<button type="submit">Sauvegarder</button>`;
    if (recipeId) {
        formActionsHTML += `<button type="button" id="delete-recipe-btn" class="btn-danger">Supprimer</button>`;
    }
    form.innerHTML += `<div class="form-actions">${formActionsHTML}</div>`;

    openModal('edit-recipe-modal');
}

export {
    $,
    openModal,
    closeModal,
    closeAllModals,
    setupCloseButtons,
    renderMainContent,
    renderDashboard,
    renderCalendar,
    listenForCalendarData,
    showRecipeDetails,
    showRecipeSelection,
    showEventModal,
    updateMealSlot,
    renderTasks,
    renderGroceries,
    renderRecipeBook,
    showEditRecipeModal
};